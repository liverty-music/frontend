import { bindable } from 'aurelia'

/**
 * The bell in the shell header: opens the notification center. While anything
 * is unread the bell is filled and carries the number of unread notifications
 * on its top corner; with nothing unread it is an outline bell with no badge.
 * The host handles the click.
 */
export class NotificationBell {
	@bindable public unreadCount = 0

	/**
	 * The badge's text: the count, or "999+" from a thousand on, so the badge
	 * holds at most four characters (Material 3 badges). The bell's accessible
	 * name keeps the whole count.
	 */
	public get badgeText(): string {
		return this.unreadCount > 999 ? '999+' : String(this.unreadCount)
	}

	/** The filled bell while something is unread, the outline one otherwise. */
	public get iconName(): string {
		return this.unreadCount > 0 ? 'bell-filled' : 'bell'
	}
}
