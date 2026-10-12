import type { PushSubscription } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/push_subscription_pb.js'
import { PushSubscriptionService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/push_subscription/v1/push_subscription_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export const IPushSubscriptionRpcClient =
	DI.createInterface<IPushSubscriptionRpcClient>(
		'IPushSubscriptionRpcClient',
		(x) => x.singleton(PushSubscriptionRpcClient),
	)

export interface IPushSubscriptionRpcClient extends PushSubscriptionRpcClient {}

export class PushSubscriptionRpcClient {
	private readonly pushClient = createClient(
		PushSubscriptionService,
		createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
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
			endpoint: { value: subscription.endpoint },
			keys: {
				p256dh: subscription.p256dh,
				auth: subscription.auth,
			},
		})
		if (!resp.subscription) {
			throw new Error('Create response missing subscription')
		}
		return resp.subscription
	}

	/**
	 * Retrieves the caller's push subscription for this browser's endpoint.
	 * Throws `ConnectError` with `Code.NotFound` when the server does not have
	 * it, so callers can branch on the error path for self-healing.
	 */
	public async get(endpoint: string): Promise<PushSubscription> {
		const resp = await this.pushClient.get({
			endpoint: { value: endpoint },
		})
		if (!resp.subscription) {
			throw new Error('Get response missing subscription')
		}
		return resp.subscription
	}

	/**
	 * Removes the caller's push subscription for this browser's endpoint. Other
	 * browsers registered by the same user remain active. Idempotent.
	 */
	public async delete(endpoint: string): Promise<void> {
		await this.pushClient.delete({
			endpoint: { value: endpoint },
		})
	}
}
