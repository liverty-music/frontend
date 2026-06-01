import { Code, ConnectError } from '@connectrpc/connect'
import { DI, ILogger, observable, resolve } from 'aurelia'
import { IUserRpcClient } from '../adapter/rpc/client/user-client'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { userIdStorageKey } from '../constants/storage-keys'
import type { User } from '../entities/user'
import { IAuthService } from './auth-service'

export const IUserService = DI.createInterface<IUserService>(
	'IUserService',
	(x) => x.singleton(UserServiceClient),
)

/**
 * Outcome of a provisioning call (`ensureLoaded` / `create`).
 *
 * `created` reports whether this call provisioned a GENUINELY NEW backend
 * account, as opposed to resolving a pre-existing one. The backend `Create`
 * RPC is idempotent — on a duplicate identity it returns the EXISTING user with
 * a wire-identical response — so the new-vs-existing distinction is not on the
 * response. The available frontend signal is the cache: a returning identity
 * already has a cached `user_id` (it signed in before on this device, or its id
 * was minted earlier this session), whereas a genuinely new account has none
 * and reaches the Create path with an empty cache. Callers key new-account-only
 * behavior (e.g. the post-signup dialog) on this flag rather than on the OIDC
 * sign-up FLOW, so a returning user who taps "Sign up" is not treated as new.
 */
export interface ProvisionResult {
	user: User | undefined
	/** True only when this call minted a brand-new backend account. */
	created: boolean
}

export interface IUserService {
	readonly current: User | undefined
	/**
	 * Hydrates `current` via the cache-then-Get-then-Create chain. The caller
	 * MUST supply the currently effective locale because the cache-miss
	 * recovery path falls through to `Create`, which requires
	 * preferred_language. Keeping it as a parameter (rather than resolving
	 * I18N inside the service) avoids coupling UserService to the i18n
	 * subsystem.
	 *
	 * Returns a `ProvisionResult` so the auth-callback can tell a brand-new
	 * account (cache-miss → Create) from a returning one (cache hit → Get)
	 * without re-deriving the cache state itself.
	 *
	 * BREAKING (since persist-user-language): the `preferredLanguage`
	 * parameter is required. Previously `ensureLoaded()` took no arguments.
	 * Any external implementer of this interface (test doubles, manual
	 * mocks) must update to the new signature; TypeScript's structural
	 * typing will catch typed implementations, but loose `as` casts in
	 * test fixtures could silently pass the wrong value.
	 */
	ensureLoaded(preferredLanguage: string): Promise<ProvisionResult>
	clear(): void
	create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<ProvisionResult>
	updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined>
	updatePreferredLanguage(preferredLanguage: string): Promise<User | undefined>
	resendEmailVerification(): Promise<void>
}

export class UserServiceClient implements IUserService {
	private readonly logger = resolve(ILogger).scopeTo('UserService')
	private readonly rpcClient = resolve(IUserRpcClient)
	private readonly authService = resolve(IAuthService)
	private readonly storage = resolve(ILocalStorage)

	// `current` is the single source of truth for the authenticated user
	// entity. Marked @observable so any view-model that binds to
	// `userService.current` (directly OR through a computed getter such as
	// SettingsRoute.currentLocale / SettingsRoute.currentHome) re-evaluates
	// automatically when the entity changes — no component-local mirror
	// state, no manual write-back. Every mutation method below assigns
	// through `this.current = ...` so the notification fires exactly once
	// per change.
	//
	// Why a public @observable field and not `@observable private _current`
	// + `public get current()`:
	// Aurelia 2's expression observer subscribes to the property accessed
	// in the binding AST. For a binding like `userService.current` it sets
	// up an observer on the `current` member of the service instance. When
	// `current` is a plain field, the @observable setter's synchronous
	// notification is exactly the channel the observer subscribes to —
	// reactivity is direct and predictable. When `current` is a *getter*
	// that returns a separately-@observable `_current`, the observer would
	// need to track the dependency through the getter body, which only
	// works reliably for getters marked `@computed` and for objects under
	// proxy observation; services injected via DI are not guaranteed to be
	// proxied in every config. The encapsulation cost here is small — the
	// `readonly` declaration on `IUserService.current` is the effective
	// contract for every consumer that resolves via DI, since DI always
	// returns the interface type. Production code never resolves the
	// concrete class.
	@observable public current: User | undefined = undefined

	// Resolves the authenticated user via:
	//   1. in-memory cache (already hydrated this session)
	//   2. localStorage cache → Get with cached user_id
	//   3. recovery: idempotent Create using JWT email — covers fresh device,
	//      cleared cache, AND any boot path (auth-callback, UserHydrationTask,
	//      direct dashboard reload) that needs a guaranteed user.
	//
	// On stale cache (cached user_id no longer matches the JWT-derived userID,
	// e.g. after manual tampering or cross-device sync), the backend returns
	// PERMISSION_DENIED — caught here, cache cleared, and the recovery path
	// runs so the app self-heals instead of locking the user out.
	public async ensureLoaded(
		preferredLanguage: string,
	): Promise<ProvisionResult> {
		// An in-memory or persisted user_id means this identity was already
		// resolved before — never a brand-new account, so `created` is false.
		if (this.current) return { user: this.current, created: false }

		const userId = this.readCachedUserId()
		if (userId) {
			try {
				this.logger.info('Loading user profile from backend (cache hit)')
				this.current = await this.rpcClient.get(userId)
				if (this.current) this.writeCachedUserId(this.current.id)
				return { user: this.current, created: false }
			} catch (err) {
				if (err instanceof ConnectError && err.code === Code.PermissionDenied) {
					this.logger.warn(
						'Cached user_id rejected by backend; clearing and recovering via Create',
					)
					this.removeCachedUserId()
				} else {
					throw err
				}
			}
		}

		// Cache miss (initial OR cleared by stale check above) — recover via
		// idempotent Create using the email from JWT claims.
		const email = this.authService.user?.profile.email
		if (!email) {
			this.logger.warn(
				'No cached user_id and no email in auth claims; cannot bootstrap user',
			)
			return { user: undefined, created: false }
		}

		this.logger.info('Bootstrapping via idempotent Create (cache miss)')
		// Create requires preferred_language; on the idempotent-return path the
		// existing row's language is preserved, so passing the current effective
		// locale is safe even for returning users.
		//
		// `created` is true here: we reached Create with no cached user_id, which
		// is the new-account path (a returning identity would have hit the Get
		// branch above). A cleared cache on an existing identity also lands here,
		// but the cache is the only new-vs-existing signal the idempotent backend
		// exposes, so this is the best available approximation and matches the
		// post-signup-dialog contract (fresh-cache identity → treat as new).
		this.current = await this.rpcClient.create(email, preferredLanguage)
		if (this.current) this.writeCachedUserId(this.current.id)
		return { user: this.current, created: true }
	}

	public clear(): void {
		this.removeCachedUserId()
		this.current = undefined
		this.logger.info('User profile cleared')
	}

	public async create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<ProvisionResult> {
		// New-account signal: no user_id cached for this identity before the call.
		// The backend Create is idempotent (a returning identity gets its existing
		// row back, wire-identical), so the pre-call cache is the only available
		// new-vs-existing signal — a returning user tapping "Sign up" already has a
		// cached id and is therefore NOT treated as new.
		const created = this.readCachedUserId() === undefined
		const user = await this.rpcClient.create(email, preferredLanguage, home)
		this.current = user
		if (user) {
			this.writeCachedUserId(user.id)
		}
		// NOTE: the guest-follow migration trigger (GuestMigrationRequested) is
		// published by AuthCallbackRoute on every successful authenticated
		// callback, NOT here. create() is also reached on the idempotent cache-miss
		// recovery, so keeping the publish at the auth-callback boundary keeps the
		// trigger at a single site with the resolved userId.
		return { user, created }
	}

	public async updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined> {
		const userId = this.requireUserId('updateHome')
		const updated = await this.rpcClient.updateHome(userId, home)
		// Same write-through pattern as updatePreferredLanguage: on a
		// populated response use the DB-authoritative entity; on an
		// empty response patch the cached field locally rather than
		// wiping `current` and losing the rest of the profile.
		if (updated) {
			this.current = updated
			this.writeCachedUserId(updated.id)
		} else if (this.current) {
			this.current = { ...this.current, home }
		}
		return this.current
	}

	public async updatePreferredLanguage(
		preferredLanguage: string,
	): Promise<User | undefined> {
		// `requireUserId` guarantees the ID is cached before the RPC fires, and
		// the backend returns the same user.id — only preferred_language changes.
		// So no writeCachedUserId here (unlike ensureLoaded / create where the ID
		// may have just been minted).
		const userId = this.requireUserId('updatePreferredLanguage')
		const updated = await this.rpcClient.updatePreferredLanguage(
			userId,
			preferredLanguage,
		)
		// Use the DB-authoritative entity when the server returned a populated
		// user with a non-empty preferredLanguage. If the server omitted the
		// user field entirely, OR returned a user whose preferredLanguage is
		// missing/empty (the mapper coerces proto3 default "" to undefined,
		// which can happen on a partial proto migration or a misconfigured
		// validator), patch the cached field locally with the value we
		// successfully sent. Wiping `current` with a stale/incomplete entity
		// would break the rest of the session for everyone reading
		// userService.current.
		if (updated?.preferredLanguage) {
			this.current = updated
		} else if (this.current) {
			this.current = { ...this.current, preferredLanguage }
		}
		return this.current
	}

	public async resendEmailVerification(): Promise<void> {
		const userId = this.requireUserId('resendEmailVerification')
		await this.rpcClient.resendEmailVerification(userId)
	}

	// requireUserId resolves the caller's internal user_id from the in-memory
	// cache first (populated by Get/Create/UpdateHome) and falls back to the
	// localStorage cache. Throws if neither is available — by the time
	// authenticated business code runs, the boot flow MUST have hydrated one
	// of them via Create or Get.
	private requireUserId(op: string): string {
		const id = this.current?.id ?? this.readCachedUserId()
		if (!id) {
			throw new Error(
				`UserService.${op}: user_id is not available; auth bootstrap did not complete`,
			)
		}
		return id
	}

	private currentExternalId(): string | undefined {
		return this.authService.user?.profile.sub
	}

	private readCachedUserId(): string | undefined {
		const ext = this.currentExternalId()
		if (!ext) return undefined
		return this.storage.getItem(userIdStorageKey(ext)) ?? undefined
	}

	private writeCachedUserId(userId: string): void {
		const ext = this.currentExternalId()
		if (!ext) return
		this.storage.setItem(userIdStorageKey(ext), userId)
	}

	private removeCachedUserId(): void {
		const ext = this.currentExternalId()
		if (!ext) return
		this.storage.removeItem(userIdStorageKey(ext))
	}
}
