import { I18N } from '@aurelia/i18n'
import {
	IRouter,
	type IRouteViewModel,
	type NavigationInstruction,
} from '@aurelia/router'
import { IEventAggregator, resolve } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import type { Notification } from '../../entities/notification'
import { IAuthService } from '../../services/auth-service'
import { INotificationStore } from '../../services/notification-store'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The notification center (`/notifications`): the signed-in fan's newest
 * notifications, including those whose push never reached them. Tapping one
 * marks it read and opens its link.
 */
export class NotificationsRoute implements IRouteViewModel {
	public readonly store = resolve(INotificationStore)
	private readonly router = resolve(IRouter)
	private readonly i18n = resolve(I18N)
	private readonly auth = resolve(IAuthService)
	private readonly ea = resolve(IEventAggregator)

	/**
	 * A guest is sent to the welcome page with a notice. The app's auth hook lets
	 * guests through every route, so the center turns them away itself.
	 */
	public async canLoad(): Promise<boolean | NavigationInstruction> {
		await this.auth.ready
		if (this.auth.isAuthenticated) return true
		this.ea.publish(
			new Snack(this.i18n.tr('notifications.signInRequired'), 'warning'),
		)
		return '/welcome'
	}

	public loading(): void {
		void this.store.refresh()
	}

	/** Mark the notification read without waiting, and open its link. */
	public open(notification: Notification): void {
		void this.store.markRead(notification.id)
		void this.router.load(notification.link)
	}

	/**
	 * When it was sent: relative to now for the last 24 hours, and as month/day
	 * before that.
	 */
	public sentLabel(notification: Notification): string {
		const elapsed = Date.now() - notification.createTime.getTime()
		if (elapsed < MINUTE) return this.i18n.tr('notifications.justNow')
		if (elapsed < HOUR) {
			const count = Math.floor(elapsed / MINUTE)
			return this.i18n.tr('notifications.minutesAgo', { count })
		}
		if (elapsed < DAY) {
			const count = Math.floor(elapsed / HOUR)
			return this.i18n.tr('notifications.hoursAgo', { count })
		}
		const date = notification.createTime
		return `${date.getMonth() + 1}/${date.getDate()}`
	}
}
