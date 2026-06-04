import { I18N, Signals } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { IUserRpcClient } from '../adapter/rpc/client/user-client'
import { loadHome, saveHome } from '../adapter/storage/guest-storage'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { clearAllHelpSeen } from '../adapter/storage/onboarding-storage'
import { userIdStorageKey } from '../constants/storage-keys'
import type { User } from '../entities/user'
import { normalizeToSupportedLanguage } from '../util/change-locale'
import { IAuthService } from './auth-service'

export const IUserStore = DI.createInterface<IUserStore>('IUserStore', (x) =>
	x.singleton(UserStore),
)

export interface IUserStore extends UserStore {}

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

/**
 * Observable owner of the current user's `home` and `preferredLanguage`,
 * resolving guest (localStorage) vs authenticated (backend) sources
 * INTERNALLY so callers never branch on `auth.isAuthenticated`.
 *
 * Phase 5b of the entity-store layer: the authenticated `User` entity (with its
 * cache→Get→Create chain, write-through update methods, and per-external_id
 * user_id cache) used to live behind a separate `UserService`. UserStore now
 * OWNS that logic directly, making it the single owner of the User entity in
 * addition to the guest `home` slice it already owned (that still lives here as
 * an `@observable` field, hydrated from the low-level `guest-storage` adapter on
 * construction and persisted through its `*Changed` hook).
 *
 * Every exposed value depends ONLY on observable state:
 *   - `current` is @observable.
 *   - `guestHome` is @observable.
 *   - `i18nLocale` mirrors the active i18n locale, kept in sync via the
 *     i18n locale-changed event. It is the single source of truth for the
 *     guest locale and the authed-NULL fallback (a render-time
 *     `i18n.getLocale()` read is not observable and would freeze the binding).
 */
export class UserStore {
	private readonly logger = resolve(ILogger).scopeTo('UserStore')
	private readonly rpcClient = resolve(IUserRpcClient)
	private readonly auth = resolve(IAuthService)
	private readonly storage = resolve(ILocalStorage)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)

	// `current` is the single source of truth for the authenticated user
	// entity. Marked @observable so any view-model that binds to
	// `userStore.current` (directly OR through a computed getter such as
	// SettingsRoute.currentLocale / SettingsRoute.currentHome) re-evaluates
	// automatically when the entity changes — no component-local mirror
	// state, no manual write-back. Every mutation method below assigns
	// through `this.current = ...` so the notification fires exactly once
	// per change.
	//
	// Why a public @observable field and not `@observable private _current`
	// + `public get current()`:
	// Aurelia 2's expression observer subscribes to the property accessed
	// in the binding AST. For a binding like `userStore.current` it sets
	// up an observer on the `current` member of the store instance. When
	// `current` is a plain field, the @observable setter's synchronous
	// notification is exactly the channel the observer subscribes to —
	// reactivity is direct and predictable. When `current` is a *getter*
	// that returns a separately-@observable `_current`, the observer would
	// need to track the dependency through the getter body, which only
	// works reliably for getters marked `@computed` and for objects under
	// proxy observation; services injected via DI are not guaranteed to be
	// proxied in every config. The encapsulation cost here is small — the
	// `readonly` declaration on `IUserStore.current` is the effective
	// contract for every consumer that resolves via DI, since DI always
	// returns the interface type. Production code never resolves the
	// concrete class.
	@observable public current: User | undefined = undefined

	/**
	 * Guest (unauthenticated) home area (ISO 3166-2 code). First-class
	 * @observable owner, hydrated from localStorage and persisted via
	 * `guestHomeChanged`, so any binding that reads the guest home re-evaluates
	 * when it changes.
	 */
	@observable public guestHome: string | null = loadHome()

	/**
	 * Reactive mirror of the active i18n locale, normalized to a supported
	 * code. Seeded from the current locale and updated whenever i18n publishes
	 * a locale change. Used as the observable fallback for the authed-NULL and
	 * guest-unset paths — replacing the unobservable `i18n.getLocale()` read
	 * that froze the guest selector highlight.
	 */
	@observable private i18nLocale: string = normalizeToSupportedLanguage(
		this.i18n.getLocale(),
	)

	constructor() {
		// The i18n subsystem publishes `{ oldLocale, newLocale }` on this EA
		// channel after every successful setLocale. Mirroring it into an
		// @observable is what makes `currentLanguage` re-evaluate for the
		// guest/authed-NULL paths without a render-time getLocale() read.
		this.ea.subscribe(
			Signals.I18N_EA_CHANNEL,
			(payload: { oldLocale: string; newLocale: string }) => {
				this.i18nLocale = normalizeToSupportedLanguage(payload.newLocale)
			},
		)
	}

	/**
	 * The current user's home area (ISO 3166-2 level1 code), or `null` when
	 * unset. Authenticated: the backend `User.home.level1`. Guest: the
	 * observable guest home. Resolved internally — callers must NOT branch on
	 * auth state.
	 */
	public get currentHome(): string | null {
		if (this.auth.isAuthenticated) {
			return this.current?.home?.level1 ?? null
		}
		return this.guestHome
	}

	/**
	 * The current user's effective preferred language (ISO 639-1 code).
	 *
	 * Authenticated: `User.preferredLanguage`, normalized to a SUPPORTED code
	 * so a non-supported backend tag ('en-US') still maps to a value the
	 * selector can highlight ('en'). When the row's preference is NULL/undefined
	 * (historical rows pending backfill), falls back to the observable
	 * `i18nLocale` mirror. Persisting that NULL → backfill is owned solely by
	 * `user-hydration-task` (an activating AppTask); this getter is a PURE
	 * projection of observable state and never issues an RPC.
	 *
	 * Guest: the observable `i18nLocale` mirror, which always equals the active
	 * i18n locale — so the selector highlight can never drift from the rendered
	 * UI. The anonymous locale has a single persisted source
	 * (`localStorage['language']`, the i18next detector cache); there is no
	 * separate guest-language key to reconcile.
	 *
	 * NEVER reads a render-time `i18n.getLocale()`; every branch resolves to
	 * observable state so dependent bindings re-evaluate on change.
	 */
	public get currentLanguage(): string {
		if (this.auth.isAuthenticated) {
			const preferred = this.current?.preferredLanguage
			if (preferred) return normalizeToSupportedLanguage(preferred)
			// NULL server preferred_language: surface the active locale. The
			// hydration task owns the one-shot backfill RPC, so this getter
			// stays side-effect-free and safe to re-evaluate on every pass.
			return this.i18nLocale
		}
		return this.i18nLocale
	}

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
		const email = this.auth.user?.profile.email
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
		// userStore.current.
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

	/**
	 * Set the guest home area (ISO 3166-2 code). Persisted via
	 * `guestHomeChanged`. Used by the unauthenticated home-selection paths
	 * (onboarding home selector, dashboard region setup).
	 */
	public setGuestHome(code: string): void {
		this.guestHome = code
		this.logger.info('Local home set', { home: code })
	}

	/**
	 * Reset the guest home slice plus the per-page help-seen flags. Used by the
	 * welcome route's fresh-tutorial reset and the sign-up onboarding hand-off.
	 * Does NOT touch the follow queue (owned by FollowStore) and does NOT touch
	 * the locale: the anonymous locale lives solely in the i18next detector's
	 * `language` key, which persists across this reset, preserving the
	 * cancelled-login behavior with no decoupling to reason about.
	 */
	public clearGuest(): void {
		this.guestHome = null
		clearAllHelpSeen()
		this.logger.info('Local home preferences cleared')
	}

	/**
	 * Persist guest home to localStorage on change.
	 */
	public guestHomeChanged(newValue: string | null): void {
		saveHome(newValue)
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
				`UserStore.${op}: user_id is not available; auth bootstrap did not complete`,
			)
		}
		return id
	}

	private currentExternalId(): string | undefined {
		return this.auth.user?.profile.sub
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
