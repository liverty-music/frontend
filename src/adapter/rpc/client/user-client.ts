import {
	UserEmail,
	UserId,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { UserService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/user/v1/user_service_connect.js'
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
			userId: new UserId({ value: userId }),
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<User | undefined> {
		// TODO(persist-user-language): swap to generated type after BSR gen.
		// The current pinned BSR package does not yet expose `preferredLanguage`
		// on CreateRequest. The cast attaches the field so the wire payload is
		// already correct against the upcoming backend; remove it once the
		// regenerated CreateRequest declares the field.
		const req = {
			email: new UserEmail({ value: email }),
			preferredLanguage,
			...(home ? { home } : {}),
		} as unknown as Parameters<typeof this.userClient.create>[0]
		const resp = await this.userClient.create(req)
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
			userId: new UserId({ value: userId }),
			home,
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async updatePreferredLanguage(
		userId: string,
		preferredLanguage: string,
	): Promise<User | undefined> {
		// TODO(persist-user-language): swap to generated RPC after BSR gen.
		// `UpdatePreferredLanguage` does not exist on the current pinned
		// UserService client yet. Once the regenerated client exposes the
		// method, replace the cast + dynamic dispatch below with a direct
		// `this.userClient.updatePreferredLanguage({...})` call mirroring the
		// shape of `updateHome` above.
		const client = this.userClient as unknown as {
			updatePreferredLanguage: (req: {
				userId: InstanceType<typeof UserId>
				preferredLanguage: string
			}) => Promise<{ user?: Parameters<typeof userFrom>[0] }>
		}
		const resp = await client.updatePreferredLanguage({
			userId: new UserId({ value: userId }),
			preferredLanguage,
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async resendEmailVerification(userId: string): Promise<void> {
		await this.userClient.resendEmailVerification({
			userId: new UserId({ value: userId }),
		})
	}
}
