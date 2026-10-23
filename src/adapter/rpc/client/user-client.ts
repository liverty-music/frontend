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

	/** The signed-in caller's User. Rejects with NotFound when none exists. */
	public async get(): Promise<User | undefined> {
		const resp = await this.userClient.get({})
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

	/**
	 * Changes the caller's full name, phone number or both
	 * (`UserService.Update`). A field left `undefined` keeps its value. The
	 * phone number MUST already be in E.164 form.
	 */
	public async update(details: {
		fullName?: string
		phoneNumber?: string
	}): Promise<User | undefined> {
		const resp = await this.userClient.update({
			...(details.fullName !== undefined
				? { fullName: { value: details.fullName } }
				: {}),
			...(details.phoneNumber !== undefined
				? { phoneNumber: { value: details.phoneNumber } }
				: {}),
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async setHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined> {
		const resp = await this.userClient.setHome({ home })
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async setPreferredLanguage(
		preferredLanguage: string,
	): Promise<User | undefined> {
		const resp = await this.userClient.setPreferredLanguage({
			preferredLanguage,
		})
		return resp.user ? userFrom(resp.user) : undefined
	}

	public async resendEmailVerification(): Promise<void> {
		await this.userClient.resendEmailVerification({})
	}

	/**
	 * Asks for a passkey registration link for `email`
	 * (`UserService.RequestPasskeyRecovery`, no sign-in needed). The answer is
	 * the same for every address; it rejects only with InvalidArgument,
	 * ResourceExhausted or a transport failure.
	 */
	public async requestPasskeyRecovery(email: string): Promise<void> {
		await this.userClient.requestPasskeyRecovery({ email: { value: email } })
	}

	/**
	 * Confirms a User's email address with the User id and code from the link
	 * in their verification email (`UserService.VerifyEmail`, no sign-in
	 * needed). Rejects with InvalidArgument for an unknown User or a wrong,
	 * expired or used code, ResourceExhausted after too many attempts, and
	 * Unavailable or a transport failure when the server cannot verify now.
	 */
	public async verifyEmail(userId: string, code: string): Promise<void> {
		await this.userClient.verifyEmail({
			userId: { value: userId },
			code: { value: code },
		})
	}
}
