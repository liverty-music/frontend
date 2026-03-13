import type { User } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { UserService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/user/v1/user_service_connect.js'
import { createClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const IUserService = DI.createInterface<IUserService>(
	'IUserService',
	(x) => x.singleton(UserServiceClient),
)

export interface IUserService {
	readonly client: PromiseClient<typeof UserService>
	readonly current: User | undefined
	ensureLoaded(): Promise<User | undefined>
	clear(): void
	updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined>
}

export class UserServiceClient implements IUserService {
	public readonly client: PromiseClient<typeof UserService>
	private readonly authService: IAuthService
	private readonly logger = resolve(ILogger).scopeTo('UserService')

	private _current: User | undefined = undefined

	constructor() {
		this.authService = resolve(IAuthService)
		this.client = createClient(
			UserService,
			createTransport(this.authService, resolve(ILogger).scopeTo('Transport')),
		)
	}

	public get current(): User | undefined {
		return this._current
	}

	public async ensureLoaded(): Promise<User | undefined> {
		if (this._current) return this._current
		if (!this.authService.isAuthenticated) return undefined

		this.logger.info('Loading user profile from backend')
		const resp = await this.client.get({})
		this._current = resp.user
		return this._current
	}

	public clear(): void {
		this._current = undefined
		this.logger.info('User profile cleared')
	}

	public async updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined> {
		const resp = await this.client.updateHome({
			home: {
				countryCode: home.countryCode,
				level1: home.level1,
				level2: home.level2,
			},
		})
		this._current = resp.user
		return resp.user
	}
}
