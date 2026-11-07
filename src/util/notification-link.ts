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

/**
 * The message the Service Worker posts to an open window it brings to the
 * front for a push the fan opened, naming the notification so the app can mark
 * it read without reloading the page.
 */
export const NOTIFICATION_OPENED_MESSAGE = 'notification-opened'

/** Whether two URLs open the same page, whatever notification they name. */
export function isSamePage(a: URL, b: URL): boolean {
	const strip = (url: URL): string => {
		const copy = new URL(url.href)
		copy.searchParams.delete(NOTIFICATION_QUERY_PARAM)
		return copy.href
	}
	return strip(a) === strip(b)
}
