import { describe, expect, it } from 'vitest'
import {
	NOTIFICATION_QUERY_PARAM,
	notificationTargetUrl,
} from './notification-link'

const ORIGIN = 'https://app.example.com'

describe('notificationTargetUrl', () => {
	// @spec components/infrastructure/fan/web/global/service-worker "Open a lottery loss notification"
	it('opens the link naming the notification', () => {
		const url = notificationTargetUrl('/events/event-1', 'n-1', ORIGIN)

		expect(url.pathname).toBe('/events/event-1')
		expect(url.searchParams.get(NOTIFICATION_QUERY_PARAM)).toBe('n-1')
	})

	it('keeps a message without an id as it is', () => {
		expect(notificationTargetUrl('/tickets', undefined, ORIGIN).href).toBe(
			`${ORIGIN}/tickets`,
		)
	})

	it('opens the root for a link that cannot be parsed', () => {
		expect(notificationTargetUrl('http://', 'n-1', ORIGIN).pathname).toBe('/')
	})
})
