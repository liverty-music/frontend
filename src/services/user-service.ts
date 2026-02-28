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
	updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined>
}

export class UserServiceClient implements IUserService {
	public readonly client: PromiseClient<typeof UserService>

	constructor() {
		const authService = resolve(IAuthService)
		this.client = createClient(
			UserService,
			createTransport(authService, resolve(ILogger).scopeTo('Transport')),
		)
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
		return resp.user
	}
}
