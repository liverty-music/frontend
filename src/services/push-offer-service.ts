import { I18N } from '@aurelia/i18n'
import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import { SNACK_LONG_MS, Snack } from '../../shared/ui/snack-bar/snack'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { StorageKeys } from '../constants/storage-keys'
import type { PermissionRequestSource } from './analytics-events'
import { IAuthService } from './auth-service'
import { INotificationManager } from './notification-manager'
import { IPushService } from './push-service'

export const IPushOfferService = DI.createInterface<IPushOfferService>(
	'IPushOfferService',
	(x) => x.singleton(PushOfferService),
)

export interface IPushOfferService extends PushOfferService {}

/** How the browser prompt opened by `accept()` ended. */
export type PushOfferOutcome = NotificationPermission | 'failed'

/** Unanswered or declined hype-change offers after which they stop for good. */
export const MAX_OFFER_DECLINES = 3

/**
 * The app's own offer to turn on push notifications, shown before the
 * browser's permission prompt. The browser prompt is opened only from a press
 * on an offer (or the Settings toggle), so it always follows a user gesture.
 *
 * Two places offer push: the post-signup sheet, which calls `accept()` from
 * its own button and is not limited, and a snack after a saved hype change on
 * My Artists, which goes through `shouldOffer()` / `offer()`: at most once per
 * app launch, and never again on this browser after 3 offers went unanswered
 * or the browser prompt was closed without an answer.
 */
export class PushOfferService {
	private readonly logger = resolve(ILogger).scopeTo('PushOfferService')
	private readonly auth = resolve(IAuthService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly storage = resolve(ILocalStorage)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)

	/** Whether the limited offer was already shown in this app launch. */
	private offeredThisLaunch = false

	/**
	 * Whether this browser can receive push. iOS and iPadOS expose the
	 * Notification API only to an app opened from the home screen.
	 */
	public get canReceivePush(): boolean {
		return (
			'Notification' in globalThis &&
			'PushManager' in globalThis &&
			'serviceWorker' in navigator
		)
	}

	/** Whether the limited (hype-change) offer may be shown now. */
	public shouldOffer(): boolean {
		return (
			this.auth.isAuthenticated &&
			this.canReceivePush &&
			this.notificationManager.permission === 'default' &&
			!this.offeredThisLaunch &&
			this.declines < MAX_OFFER_DECLINES
		)
	}

	/**
	 * Show `message` as a snack with the 「オンにする」 action. A snack that
	 * closes without its action counts as one unanswered offer.
	 */
	public offer(message: string): void {
		this.offeredThisLaunch = true
		let pressed = false
		this.ea.publish(
			new Snack(message, 'info', {
				duration: SNACK_LONG_MS,
				icon: 'bell',
				action: {
					label: this.i18n.tr('pushOffer.action'),
					callback: () => {
						pressed = true
						void this.accept({
							source: 'notification_prompt',
							counted: true,
						})
					},
				},
				onDismiss: () => {
					if (!pressed) this.recordDecline()
				},
			}),
		)
	}

	/**
	 * Ask the browser for notification permission, at once, and register push
	 * when allowed. MUST be called from the press handler so the browser
	 * prompt follows the user's gesture. Reports the outcome with a snack; a
	 * prompt closed without an answer shows nothing and, for the limited
	 * offer (`counted`), counts as one unanswered offer. A caller that states
	 * a block or a failure itself (the post-signup sheet) passes `inline`.
	 * `source` names the offer in the report of the fan's answer, which
	 * `NotificationManager` sends.
	 */
	public async accept(opts: {
		source: PermissionRequestSource
		counted: boolean
		inline?: boolean
	}): Promise<PushOfferOutcome> {
		try {
			await this.pushService.create(opts.source)
		} catch (err) {
			this.logger.error('Failed to register push notifications', err)
			if (!opts.inline) {
				this.ea.publish(new Snack(this.i18n.tr('pushOffer.failed'), 'error'))
			}
			return 'failed'
		}
		const permission = this.notificationManager.permission
		if (permission === 'granted') {
			this.ea.publish(new Snack(this.i18n.tr('pushOffer.allowed')))
		} else if (permission === 'denied') {
			if (!opts.inline) {
				this.ea.publish(new Snack(this.i18n.tr('pushOffer.blocked'), 'warning'))
			}
		} else if (opts.counted) {
			this.recordDecline()
		}
		return permission
	}

	private get declines(): number {
		const n = Number(this.storage.getItem(StorageKeys.pushOfferDeclines))
		return Number.isFinite(n) ? n : 0
	}

	private recordDecline(): void {
		this.storage.setItem(
			StorageKeys.pushOfferDeclines,
			String(this.declines + 1),
		)
	}
}
