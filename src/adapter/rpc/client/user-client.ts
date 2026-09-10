import { UserService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/user/v1/user_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
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
			resolve(IAppConfig),
		),
	)

	public async get(userId: string): Promise<User | undefined> {
		const resp = await this.userClient.get({
			userId: { value: userId },
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined> {
		const resp = await this.userClient.create({
			email: { value: email },
			preferredLanguage,
			...(home ? { home } : {}),
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async updateHome(
		userId: string,
		home: {
			countryCode: string
			level1: string
			level2?: string
		},
	): Promise<User | undefined> {
		const resp = await this.userClient.updateHome({
			userId: { value: userId },
			home,
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async updatePreferredLanguage(
		userId: string,
		preferredLanguage: string,
	): Promise<User | undefined> {
		const resp = await this.userClient.updatePreferredLanguage({
			userId: { value: userId },
			preferredLanguage,
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async resendEmailVerification(userId: string): Promise<void> {
		await this.userClient.resendEmailVerification({
			userId: { value: userId },
		})
	}
}
