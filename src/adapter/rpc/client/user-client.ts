import { UserEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { UserService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/user/v1/user_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { User } from '../../../entities/user'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { userFrom } from '../mapper/user-mapper'

export const IUserRpcClient = DI.createInterface<IUserRpcClient>(
	'IUserRpcClient',
	(x) => x.singleton(UserRpcClient),
)

export interface IUserRpcClient extends UserRpcClient {}

export class UserRpcClient {
	private readonly userClient = createClient(
		UserService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
		),
	)

	public async get(): Promise<User | undefined> {
		const resp = await this.userClient.get({})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async create(
		email: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined> {
		const resp = await this.userClient.create({
			email: new UserEmail({ value: email }),
			...(home ? { home } : {}),
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined> {
		const resp = await this.userClient.updateHome({ home })
		return resp.user ? userFrom(resp.user) : undefined
	}
}
