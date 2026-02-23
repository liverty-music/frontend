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
}

export class UserServiceClient implements IUserService {
	public readonly client: PromiseClient<typeof UserService>

	constructor() {
		const authService = resolve(IAuthService)
		this.client = createClient(UserService, createTransport(authService, resolve(ILogger).scopeTo('Transport')))
	}
}
