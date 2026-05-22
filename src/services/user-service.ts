import { Code, ConnectError } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IUserRpcClient } from '../adapter/rpc/client/user-client'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { userIdStorageKey } from '../constants/storage-keys'
import type { User } from '../entities/user'
import { IAuthService } from './auth-service'

export const IUserService = DI.createInterface<IUserService>(
	'IUserService',
	(x) => x.singleton(UserServiceClient),
)

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
	 * BREAKING (since persist-user-language): the `preferredLanguage`
	 * parameter is required. Previously `ensureLoaded()` took no arguments.
	 * Any external implementer of this interface (test doubles, manual
	 * mocks) must update to the new signature; TypeScript's structural
	 * typing will catch typed implementations, but loose `as` casts in
	 * test fixtures could silently pass the wrong value.
	 */
	ensureLoaded(preferredLanguage: string): Promise<User | undefined>
	clear(): void
	create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined>
	updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined>
	updatePreferredLanguage(preferredLanguage: string): Promise<User | undefined>
	/**
	 * Backfill variant for the hydration task's NULL-language code path.
	 * Runs the same RPC as `updatePreferredLanguage` but with a race-safe
	 * write-through: skips the in-memory cache mutation when the cached
	 * `preferredLanguage` drifted between RPC dispatch and resolution.
	 *
	 * The hydration backfill is fire-and-forget — the user can navigate
	 * to settings and pick a different language during the in-flight
	 * period. Without this guard, `updatePreferredLanguage`'s
	 * unconditional write-through would clobber the explicit choice
	 * (settings shows the user's value briefly, backfill resolves later
	 * and reverts the in-memory cache to `clientLocale`). The DB still
	 * reflects last-writer-wins; a proper fix needs server-side
	 * optimistic locking.
	 */
	backfillPreferredLanguage(
		preferredLanguage: string,
	): Promise<User | undefined>
	/**
	 * Roll back the in-memory `current.preferredLanguage` without an RPC.
	 * Intended for the SetLocaleError recovery path: when the backend RPC
	 * committed but the local i18n switch then failed, the cached
	 * `preferredLanguage` write-through has the new value while i18n is
	 * still on the old; this method realigns the cache with i18n so the
	 * settings selector and `t=` bindings stop disagreeing about which
	 * language is active. The DB value remains the new one and the next
	 * hydration re-syncs both layers.
	 */
	revertCachedPreferredLanguage(previous: string | undefined): void
	resendEmailVerification(): Promise<void>
}

export class UserServiceClient implements IUserService {
	private readonly logger = resolve(ILogger).scopeTo('UserService')
	private readonly rpcClient = resolve(IUserRpcClient)
	private readonly authService = resolve(IAuthService)
	private readonly storage = resolve(ILocalStorage)

	private _current: User | undefined = undefined

	public get current(): User | undefined {
		return this._current
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
	): Promise<User | undefined> {
		if (this._current) return this._current

		const userId = this.readCachedUserId()
		if (userId) {
			try {
				this.logger.info('Loading user profile from backend (cache hit)')
				this._current = await this.rpcClient.get(userId)
				if (this._current) this.writeCachedUserId(this._current.id)
				return this._current
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
			return undefined
		}

		this.logger.info('Bootstrapping via idempotent Create (cache miss)')
		// Create requires preferred_language; on the idempotent-return path the
		// existing row's language is preserved, so passing the current effective
		// locale is safe even for returning users.
		this._current = await this.rpcClient.create(email, preferredLanguage)
		if (this._current) this.writeCachedUserId(this._current.id)
		return this._current
	}

	public clear(): void {
		this.removeCachedUserId()
		this._current = undefined
		this.logger.info('User profile cleared')
	}

	public async create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined> {
		const user = await this.rpcClient.create(email, preferredLanguage, home)
		this._current = user
		if (user) this.writeCachedUserId(user.id)
		return user
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
		// wiping `_current` and losing the rest of the profile.
		if (updated) {
			this._current = updated
			this.writeCachedUserId(updated.id)
		} else if (this._current) {
			this._current = { ...this._current, home }
		}
		return this._current
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
		// successfully sent. Wiping _current with a stale/incomplete entity
		// would break the rest of the session for everyone reading
		// userService.current.
		if (updated?.preferredLanguage) {
			this._current = updated
		} else if (this._current) {
			this._current = { ...this._current, preferredLanguage }
		}
		return this._current
	}

	public async backfillPreferredLanguage(
		preferredLanguage: string,
	): Promise<User | undefined> {
		const userId = this.requireUserId('backfillPreferredLanguage')
		// Snapshot the cached preferredLanguage BEFORE the RPC. The
		// hydration backfill fires only when this value is undefined
		// (NULL DB row), but a concurrent settings update can mutate it
		// to a user-chosen value during the in-flight RPC roundtrip. If
		// the snapshot differs from the post-RPC cached value, that
		// concurrent write wins — skip our write-through so we don't
		// clobber the user's explicit choice in memory. The DB still
		// reflects last-writer-wins; this guard keeps the settings UI
		// and `t=` bindings consistent until the next hydration re-syncs.
		const beforeRpc = this._current?.preferredLanguage
		const updated = await this.rpcClient.updatePreferredLanguage(
			userId,
			preferredLanguage,
		)
		const cachedDrifted = this._current?.preferredLanguage !== beforeRpc
		if (cachedDrifted) {
			this.logger.warn(
				'Backfill detected concurrent preferredLanguage change; skipping write-through',
				{ before: beforeRpc, now: this._current?.preferredLanguage },
			)
			return this._current
		}
		if (updated?.preferredLanguage) {
			this._current = updated
		} else if (this._current) {
			this._current = { ...this._current, preferredLanguage }
		}
		return this._current
	}

	public revertCachedPreferredLanguage(previous: string | undefined): void {
		if (!this._current) return
		this._current = { ...this._current, preferredLanguage: previous }
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
		const id = this._current?.id ?? this.readCachedUserId()
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
