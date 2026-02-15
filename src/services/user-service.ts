import { DI, resolve } from 'aurelia'
import { type PromiseClient, createClient } from '@connectrpc/connect'
import { UserService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/user/v1/user_service_connect.js'
import { createTransport } from './grpc-transport'
import { IAuthService } from './auth-service'

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
		this.client = createClient(UserService, createTransport(authService))
	}
}
