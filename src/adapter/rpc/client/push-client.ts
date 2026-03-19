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

	public async subscribe(subscription: {
		endpoint: string
		p256dh: string
		auth: string
	}): Promise<void> {
		await this.pushClient.subscribe(subscription)
	}

	public async unsubscribe(): Promise<void> {
		await this.pushClient.unsubscribe({})
	}
}
