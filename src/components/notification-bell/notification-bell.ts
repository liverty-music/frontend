import { bindable } from 'aurelia'

/**
 * The bell in the shell header: opens the notification center and shows the
 * number of unread notifications as a badge, or no badge when there is none.
 * The host handles the click.
 */
export class NotificationBell {
	@bindable public unreadCount = 0
}
