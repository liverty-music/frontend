import { PushNotificationService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/push_notification/v1/push_notification_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { INotificationManager } from './notification-manager'

export const IPushService = DI.createInterface<IPushService>(
	'IPushService',
	(x) => x.singleton(PushServiceClient),
)

export interface IPushService extends PushServiceClient {}

export class PushServiceClient {
	private static readonly SW_READY_TIMEOUT_MS = 10_000

	private readonly logger = resolve(ILogger).scopeTo('PushService')
	private readonly authService = resolve(IAuthService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushClient = createClient(
		PushNotificationService,
		createTransport(this.authService),
	)

	// VAPID public key injected via Vite build environment variable
	private readonly vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

	private async getRegistration(): Promise<ServiceWorkerRegistration> {
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error('Service Worker ready timed out')),
				PushServiceClient.SW_READY_TIMEOUT_MS,
			),
		)
		return Promise.race([navigator.serviceWorker.ready, timeout])
	}

	public async subscribe(): Promise<void> {
		if (!this.vapidPublicKey) {
			this.logger.warn(
				'VITE_VAPID_PUBLIC_KEY is not set, cannot subscribe to push',
			)
			return
		}

		const permission = await this.notificationManager.requestPermission()
		if (permission !== 'granted') {
			this.logger.info('Notification permission not granted', {
				permission,
			})
			return
		}

		const registration = await this.getRegistration()
		let subscription = await registration.pushManager.getSubscription()

		if (!subscription) {
			this.logger.info('Creating new push subscription')
			subscription = await registration.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: this.vapidPublicKey,
			})
		}

		const json = subscription.toJSON()
		const endpoint = json.endpoint ?? ''
		const p256dh = json.keys?.p256dh ?? ''
		const auth = json.keys?.auth ?? ''

		this.logger.info('Sending push subscription to backend', { endpoint })

		try {
			await this.pushClient.subscribe({ endpoint, p256dh, auth })
			this.logger.info('Push subscription registered successfully')
		} catch (err) {
			this.logger.error(
				'Failed to register push subscription with backend',
				err,
			)
			throw err
		}
	}

	public async unsubscribe(): Promise<void> {
		const registration = await this.getRegistration()
		const subscription = await registration.pushManager.getSubscription()

		if (subscription) {
			await subscription.unsubscribe()
			this.logger.info('Browser push subscription removed')
		}

		try {
			await this.pushClient.unsubscribe({})
			this.logger.info('Push subscription removed from backend successfully')
		} catch (err) {
			this.logger.error('Failed to remove push subscription from backend', err)
			throw err
		}
	}
}
