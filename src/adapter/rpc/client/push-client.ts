import {
	PushEndpoint,
	PushKeys,
	type PushSubscription,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/push_subscription_pb.js'
import { UserId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { PushNotificationService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/push_notification/v1/push_notification_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const IPushRpcClient = DI.createInterface<IPushRpcClient>(
	'IPushRpcClient',
	(x) => x.singleton(PushRpcClient),
)

export interface IPushRpcClient extends PushRpcClient {}

export class PushRpcClient {
	private readonly pushClient = createClient(
		PushNotificationService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
		),
	)

	/**
	 * Registers the calling browser's push subscription. UPSERT by endpoint.
	 * The backend resolves the owning user from the JWT — no user_id is sent.
	 */
	public async create(subscription: {
		endpoint: string
		p256dh: string
		auth: string
	}): Promise<PushSubscription> {
		const resp = await this.pushClient.create({
			endpoint: new PushEndpoint({ value: subscription.endpoint }),
			keys: new PushKeys({
				p256dh: subscription.p256dh,
				auth: subscription.auth,
			}),
		})
		if (!resp.subscription) {
			throw new Error('Create response missing subscription')
		}
		return resp.subscription
	}

	/**
	 * Retrieves the push subscription for (userId, endpoint). Throws
	 * `ConnectError` with `Code.NotFound` when no row matches so callers can
	 * branch on the error path for self-healing.
	 */
	public async get(
		userId: string,
		endpoint: string,
	): Promise<PushSubscription> {
		const resp = await this.pushClient.get({
			userId: new UserId({ value: userId }),
			endpoint: new PushEndpoint({ value: endpoint }),
		})
		if (!resp.subscription) {
			throw new Error('Get response missing subscription')
		}
		return resp.subscription
	}

	/**
	 * Removes the push subscription for (userId, endpoint). Only the
	 * specified browser's row is deleted; other browsers registered by
	 * the same user remain active. Idempotent.
	 */
	public async delete(userId: string, endpoint: string): Promise<void> {
		await this.pushClient.delete({
			userId: new UserId({ value: userId }),
			endpoint: new PushEndpoint({ value: endpoint }),
		})
	}
}
