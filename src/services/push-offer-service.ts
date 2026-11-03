import { I18N } from '@aurelia/i18n'
import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import { Snack } from '../../shared/ui/snack-bar/snack'
import type { PermissionRequestSource } from './analytics-events'
import { INotificationManager } from './notification-manager'
import { IPushService } from './push-service'

export const IPushOfferService = DI.createInterface<IPushOfferService>(
	'IPushOfferService',
	(x) => x.singleton(PushOfferService),
)

export interface IPushOfferService extends PushOfferService {}

/** How the browser prompt opened by `accept()` ended. */
export type PushOfferOutcome = NotificationPermission | 'failed'

/**
 * What push means for this browser now:
 * - `on`: notifications are allowed and this browser is registered for push.
 * - `offerable`: the browser can receive push, and notifications are
 *   undecided, or allowed while this browser is not registered (the offer
 *   then registers it without a browser prompt).
 * - `settings`: notifications are blocked, or the browser cannot receive push
 *   (iOS Safari outside the home-screen app); the place of the offer links to
 *   Settings instead.
 */
export type PushState = 'on' | 'offerable' | 'settings'

/**
 * The app's own offer to turn on push notifications, shown before the
 * browser's permission prompt. The browser prompt is opened only from a press
 * on an offer (or the Settings toggle), so it always follows a user gesture.
 *
 * The offers are the post-signup sheet (once per sign-up, its own rule), the
 * hype snack on My Artists and the push line of the event detail sheet. The
 * last two have no limit: they read `pushState()` each time they show and
 * call `accept()` from their action. Whether the fan is signed in is the
 * caller's to check; a guest never sees an offer.
 */
export class PushOfferService {
	private readonly logger = resolve(ILogger).scopeTo('PushOfferService')
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)

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

	/** What push means for this browser now; see {@link PushState}. */
	public async pushState(): Promise<PushState> {
		if (!this.canReceivePush) return 'settings'
		const permission = this.notificationManager.permission
		if (permission === 'denied') return 'settings'
		if (permission === 'default') return 'offerable'
		try {
			const subscription = await this.pushService.getBrowserSubscription()
			return subscription ? 'on' : 'offerable'
		} catch (err) {
			// No service worker within its timeout: nothing is registered here.
			this.logger.warn('Could not read the push subscription', err)
			return 'offerable'
		}
	}

	/**
	 * Ask the browser for notification permission, at once, and register push
	 * when allowed. MUST be called from the press handler so the browser
	 * prompt follows the user's gesture; when notifications are already
	 * allowed, no prompt opens and this browser is registered. Reports the
	 * outcome with a snack; a prompt closed without an answer shows nothing.
	 * A caller that states a block or a failure itself (the post-signup
	 * sheet) passes `inline`.
	 * `source` names the offer in the report of the fan's answer, which
	 * `NotificationManager` sends.
	 */
	public async accept(opts: {
		source: PermissionRequestSource
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
		}
		return permission
	}
}
