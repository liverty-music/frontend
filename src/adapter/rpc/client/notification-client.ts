import { NotificationService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/notification/v1/notification_service_pb.js'
import {
	type Client,
	Code,
	ConnectError,
	createClient,
} from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../../config/app-config'
import type { Notification } from '../../../entities/notification'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { notificationFrom } from '../mapper/notification-mapper'

export const INotificationRpcClient =
	DI.createInterface<INotificationRpcClient>('INotificationRpcClient', (x) =>
		x.singleton(NotificationRpcClient),
	)

export interface INotificationRpcClient extends NotificationRpcClient {}

/** NotificationRpcClient lists the signed-in fan's notifications and marks one read. */
export class NotificationRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('NotificationRpcClient')
	private readonly client: Client<typeof NotificationService>

	constructor() {
		const transport = createTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('Transport'),
			resolve(IAppConfig),
		)
		this.client = createClient(NotificationService, transport)
	}

	/**
	 * The fan's newest notifications, newest first. A signed-in identity with no
	 * account yet (the server answers NotFound) has none. Other failures reject.
	 */
	public async list(signal?: AbortSignal): Promise<Notification[]> {
		try {
			const response = await this.client.list({}, { signal })
			return response.notifications.map(notificationFrom)
		} catch (err) {
			if (ConnectError.from(err).code === Code.NotFound) return []
			this.logger.warn('Notification List failed', { error: err })
			throw err
		}
	}

	/** Mark one of the fan's notifications read. Failures reject. */
	public async markRead(id: string): Promise<void> {
		await this.client.markRead({ notificationId: { value: id } })
	}
}
