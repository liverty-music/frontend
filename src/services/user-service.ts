import { DI, resolve } from 'aurelia'
import { createClient } from '@connectrpc/connect'
import { UserService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/user/v1/user_service_connect'
import { transport } from './grpc-transport'

export const IUserService = DI.createInterface<IUserService>(
	'IUserService',
	(x) => x.singleton(UserServiceClient),
)

export interface IUserService {
	readonly client: ReturnType<typeof createClient<typeof UserService>>
}

export class UserServiceClient implements IUserService {
	public readonly client = createClient(UserService, transport)
}
