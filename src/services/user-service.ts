import { DI, ILogger, resolve } from 'aurelia'
import { IUserRpcClient } from '../adapter/rpc/client/user-client'
import type { User } from '../entities/user'

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
	): Promise<void>
	updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined>
}

export class UserServiceClient implements IUserService {
	private readonly logger = resolve(ILogger).scopeTo('UserService')
	private readonly rpcClient = resolve(IUserRpcClient)

	private _current: User | undefined = undefined

	public get current(): User | undefined {
		return this._current
	}

	public async ensureLoaded(): Promise<User | undefined> {
		if (this._current) return this._current

		this.logger.info('Loading user profile from backend')
		this._current = await this.rpcClient.get()
		return this._current
	}

	public clear(): void {
		this._current = undefined
		this.logger.info('User profile cleared')
	}

	public async create(
		email: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<void> {
		await this.rpcClient.create(email, home)
	}

	public async updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined> {
		this._current = await this.rpcClient.updateHome(home)
		return this._current
	}
}
