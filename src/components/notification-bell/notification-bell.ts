import { bindable } from 'aurelia'

/**
 * The bell in the shell header: opens the notification center. While anything
 * is unread the bell is filled and carries the number of unread notifications
 * on its top corner; with nothing unread it is an outline bell with no badge.
 * The host handles the click.
 */
export class NotificationBell {
	@bindable public unreadCount = 0

	/** The filled bell while something is unread, the outline one otherwise. */
	public get iconName(): string {
		return this.unreadCount > 0 ? 'bell-filled' : 'bell'
	}
}
