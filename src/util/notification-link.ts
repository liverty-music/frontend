/**
 * The query parameter that names the opened Notification in the URL a push
 * opens. The Service Worker sets it; the app shell reads and removes it.
 */
export const NOTIFICATION_QUERY_PARAM = 'notification'

/**
 * The URL a push notification opens: its link, on this origin, naming the
 * notification so the app can mark it read. A link that cannot be parsed opens
 * the root.
 */
export function notificationTargetUrl(
	link: string,
	notificationId: string | undefined,
	origin: string,
): URL {
	let target: URL
	try {
		target = new URL(link, origin)
	} catch {
		target = new URL('/', origin)
	}
	if (notificationId) {
		target.searchParams.set(NOTIFICATION_QUERY_PARAM, notificationId)
	}
	return target
}
