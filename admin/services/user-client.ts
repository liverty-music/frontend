import type { DeletionBlocker } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/deletion_blocker_pb.js'
import type { User } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { UserService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/user/v1/user_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { DeletionBlocker, User }

/** A fan User found by email, with what stops its deletion. */
export interface FoundUser {
	readonly user: User | undefined
	/** Empty when the User can be deleted. */
	readonly blockers: DeletionBlocker[]
}

export const IAdminUserClient = DI.createInterface<IAdminUserClient>(
	'IAdminUserClient',
	(x) => x.singleton(AdminUserClient),
)

export interface IAdminUserClient extends AdminUserClient {}

/**
 * Admin-local wrapper around the generated admin `UserService` client
 * (OpenSpec change `delete-fan-accounts`). Like {@link OrganizerClient}, it
 * wraps plain strings into the generated message shells, logs each call and
 * propagates errors; the route turns `ConnectError` codes into copy.
 *
 * Email addresses are personal data: they are never logged.
 */
export class AdminUserClient {
	private readonly logger = resolve(ILogger).scopeTo('AdminUserClient')
	private readonly client = createClient(
		UserService,
		createAdminTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * The fan User registered with `email` (matched exactly, letter case
	 * ignored) and its deletion blockers. Rejects with NotFound when no User
	 * has the address.
	 */
	public async getByEmail(
		email: string,
		signal?: AbortSignal,
	): Promise<FoundUser> {
		this.logger.info('Looking up a user by email')
		try {
			const response = await this.client.getByEmail(
				{ email: { value: email } },
				{ signal },
			)
			return { user: response.user, blockers: response.blockers }
		} catch (err) {
			this.logger.warn('getByEmail failed', { error: err })
			throw err
		}
	}

	/**
	 * Deletes the fan User and its sign-in identity. Rejects with
	 * FailedPrecondition while a deletion blocker exists.
	 */
	public async delete(userId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Deleting user', { userId })
		try {
			await this.client.delete({ userId: { value: userId } }, { signal })
		} catch (err) {
			this.logger.warn('delete failed', { userId, error: err })
			throw err
		}
	}
}
