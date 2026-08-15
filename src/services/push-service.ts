import { Code, ConnectError } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IPushRpcClient } from '../adapter/rpc/client/push-client'
import { IAppConfig } from '../config/app-config'
import { INotificationManager } from './notification-manager'

export const IPushService = DI.createInterface<IPushService>(
	'IPushService',
	(x) => x.singleton(PushServiceClient),
)

export interface IPushService extends PushServiceClient {}

/**
 * Describes the current browser's subscription state as resolved from the
 * browser's `PushManager`. `null` means the browser has no active push
 * subscription object, in which case the user cannot have an enabled toggle
 * regardless of what the backend stores.
 */
export type BrowserPushSubscription = {
	endpoint: string
	p256dh: string
	auth: string
}

/**
 * Resolved push state after a recovery pass:
 * - `enabled`: the browser has a subscription registered with the backend.
 * - `needs-permission`: notification permission is not granted; the UI must
 *   surface a re-enable affordance rather than silently staying OFF.
 * - `error`: subscribe/register failed; the toggle must reflect OFF (never a
 *   success state) and the failure is surfaced, not swallowed.
 */
export type PushRecoveryState = 'enabled' | 'needs-permission' | 'error'

export class PushServiceClient {
	private static readonly SW_READY_TIMEOUT_MS = 10_000

	private readonly logger = resolve(ILogger).scopeTo('PushService')
	private readonly rpcClient = resolve(IPushRpcClient)
	private readonly notificationManager = resolve(INotificationManager)

	// VAPID public key sourced from runtime AppConfig (see IAppConfig)
	private readonly vapidPublicKey = resolve(IAppConfig).vapidPublicKey

	// Guards the auto re-subscribe path against overlapping runs (e.g. an
	// app-open recovery racing a settings-load recovery). The real "run once per
	// loss" gate is the state check itself: after a successful re-subscribe
	// `getSubscription()` is non-null, so resolvePushState no longer takes the
	// subscribe branch.
	private resubscribing = false

	private async getRegistration(): Promise<ServiceWorkerRegistration> {
		const timeout = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error('Service Worker ready timed out')),
				PushServiceClient.SW_READY_TIMEOUT_MS,
			),
		)
		return Promise.race([navigator.serviceWorker.ready, timeout])
	}

	/**
	 * Returns the browser's current push subscription material, or `null`
	 * when the browser has no active subscription. The endpoint here
	 * uniquely identifies this browser session and is used as the key for
	 * all subsequent Get/Delete backend calls.
	 */
	public async getBrowserSubscription(): Promise<BrowserPushSubscription | null> {
		const registration = await this.getRegistration()
		const sub = await registration.pushManager.getSubscription()
		if (!sub) return null
		const json = sub.toJSON()
		return {
			endpoint: json.endpoint ?? '',
			p256dh: json.keys?.p256dh ?? '',
			auth: json.keys?.auth ?? '',
		}
	}

	/**
	 * Requests notification permission (if needed), subscribes via
	 * `PushManager`, and registers the resulting subscription with the
	 * backend via the `Create` RPC.
	 *
	 * Returns the endpoint on success, or `null` when the user denied the
	 * permission prompt or VAPID is missing.
	 */
	public async create(): Promise<string | null> {
		if (!this.vapidPublicKey) {
			this.logger.warn(
				'VITE_VAPID_PUBLIC_KEY is not set, cannot subscribe to push',
			)
			return null
		}

		const permission = await this.notificationManager.requestPermission()
		if (permission !== 'granted') {
			this.logger.info('Notification permission not granted', { permission })
			return null
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
			await this.rpcClient.create({ endpoint, p256dh, auth })
			this.logger.info('Push subscription registered successfully')
			return endpoint
		} catch (err) {
			this.logger.error(
				'Failed to register push subscription with backend',
				err,
			)
			throw err
		}
	}

	/**
	 * Checks whether the backend has the current browser's subscription on file.
	 * Returns `true` when the `(userId, endpoint)` pair resolves to a row,
	 * `false` when the backend returns `NOT_FOUND`. Any other error is rethrown.
	 */
	public async existsOnBackend(
		userId: string,
		endpoint: string,
	): Promise<boolean> {
		try {
			await this.rpcClient.get(userId, endpoint)
			return true
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.NotFound) {
				return false
			}
			throw err
		}
	}

	/**
	 * Registers the supplied browser subscription material with the backend
	 * without re-requesting notification permission. Used by the settings
	 * self-heal flow where the browser already has a subscription but the
	 * backend does not.
	 */
	public async createFrom(sub: BrowserPushSubscription): Promise<void> {
		await this.rpcClient.create(sub)
	}

	/**
	 * Reconciles the browser's push subscription with the backend without any
	 * user interaction, covering both divergence directions:
	 *
	 * - Browser HAS a subscription the backend is missing → re-register it via
	 *   `Create` (the existing self-heal).
	 * - Browser has NO subscription but permission is granted → auto re-subscribe
	 *   with the VAPID key and register it, so a permission-granted user is never
	 *   left silently unsubscribed (the exact gap behind the 2026-08 outage).
	 *
	 * When permission is NOT granted, returns `needs-permission` so the caller can
	 * surface a re-enable affordance instead of silently staying OFF. Any
	 * subscribe/register failure returns `error` (logged, never swallowed) so the
	 * UI reflects OFF rather than a false success.
	 *
	 * The auto re-subscribe is gated on the state check (`getSubscription()` null
	 * AND permission granted) so it runs once per actual loss, not on every
	 * navigation.
	 */
	public async resolvePushState(userId?: string): Promise<PushRecoveryState> {
		if (this.notificationManager.permission !== 'granted') {
			return 'needs-permission'
		}

		try {
			const browserSub = await this.getBrowserSubscription()

			if (browserSub) {
				// Browser has a subscription. Ensure the backend has the row too.
				if (userId) {
					const exists = await this.existsOnBackend(userId, browserSub.endpoint)
					if (!exists) {
						this.logger.info(
							'Push subscription exists on browser but not on backend; self-healing via Create',
						)
						await this.createFrom(browserSub)
					}
				}
				return 'enabled'
			}

			// Permission granted but the browser has no subscription (410 cleanup,
			// PWA reinstall, site-data clear). Auto re-subscribe once per loss.
			if (this.resubscribing) return 'enabled'
			this.resubscribing = true
			try {
				this.logger.info(
					'Permission granted but no browser subscription; auto re-subscribing',
				)
				const endpoint = await this.create()
				return endpoint ? 'enabled' : 'error'
			} finally {
				this.resubscribing = false
			}
		} catch (err) {
			this.logger.error('Failed to resolve push state', err)
			return 'error'
		}
	}

	/**
	 * Removes the browser's push subscription and instructs the backend to
	 * delete the matching `(userId, endpoint)` row. Only this browser is
	 * affected; other browsers registered by the same user remain active.
	 */
	public async delete(userId: string): Promise<void> {
		const registration = await this.getRegistration()
		const subscription = await registration.pushManager.getSubscription()

		if (!subscription) {
			this.logger.info('No browser subscription to delete')
			return
		}
		const endpoint = subscription.toJSON().endpoint ?? ''

		try {
			await this.rpcClient.delete(userId, endpoint)
			this.logger.info('Push subscription removed from backend successfully')
		} catch (err) {
			this.logger.error('Failed to remove push subscription from backend', err)
			throw err
		}

		await subscription.unsubscribe()
		this.logger.info('Browser push subscription removed')
	}
}
