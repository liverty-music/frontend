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

	// Reads the cached internal user_id from localStorage and calls Get. The
	// rpc-auth-scoping convention requires the caller to supply user_id on
	// every per-user RPC; on cache miss this method returns undefined so
	// callers can fall back to Create (which is the sanctioned cache-miss
	// recovery path — idempotent on duplicate external_id).
	public async ensureLoaded(): Promise<User | undefined> {
		if (this._current) return this._current

		const userId = this.readCachedUserId()
		if (!userId) {
			this.logger.info(
				'No cached user_id; skipping Get (caller should fall back to Create)',
			)
			return undefined
		}

		this.logger.info('Loading user profile from backend')
		this._current = await this.rpcClient.get(userId)
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
