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
	ensureLoaded(): Promise<User | undefined>
	clear(): void
	create(
		email: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined>
	updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined>
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
	public async ensureLoaded(): Promise<User | undefined> {
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
		this._current = await this.rpcClient.create(email)
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
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined> {
		const user = await this.rpcClient.create(email, home)
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
		this._current = await this.rpcClient.updateHome(userId, home)
		if (this._current) this.writeCachedUserId(this._current.id)
		return this._current
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
