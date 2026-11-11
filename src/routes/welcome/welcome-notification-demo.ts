import { bindable, INode, resolve } from 'aurelia'

/**
 * The first step of Welcome's demo: a mock new-concert push notification and
 * an invitation to tap it. A tap is told with a `notification-tap` event; the
 * caller then sets `exiting` while the notification dismisses upward.
 */
export class WelcomeNotificationDemo {
	private readonly host = resolve(INode) as HTMLElement

	/** The notification is dismissing; the caller swaps in the timetable after. */
	@bindable public exiting = false

	public tap(): void {
		this.host.dispatchEvent(
			new CustomEvent('notification-tap', { bubbles: true }),
		)
	}
}
