/**
 * One notification sent to the signed-in fan, as the notification center shows
 * it. The server renders the title, body and link in the fan's language.
 *
 * @source proto/liverty_music/entity/v1/notification.proto — Notification
 */
export interface Notification {
	readonly id: string
	readonly title: string
	/** The body, with line breaks kept. */
	readonly body: string
	/** The in-app link the notification opens. */
	readonly link: string
	readonly createTime: Date
	/** When the fan read it; absent until read. */
	readonly readTime?: Date
}
