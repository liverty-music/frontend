import { describe, expect, it } from 'vitest'
import {
	isSamePage,
	NOTIFICATION_QUERY_PARAM,
	notificationTargetUrl,
} from './notification-link'

const ORIGIN = 'https://app.example.com'

describe('notificationTargetUrl', () => {
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

describe('isSamePage', () => {
	it('matches an open page whatever notification the link names', () => {
		const open = new URL(`${ORIGIN}/events/event-1`)
		const target = notificationTargetUrl('/events/event-1', 'n-1', ORIGIN)

		expect(isSamePage(open, target)).toBe(true)
	})

	it('tells different pages apart', () => {
		const open = new URL(`${ORIGIN}/tickets`)
		const target = notificationTargetUrl('/events/event-1', 'n-1', ORIGIN)

		expect(isSamePage(open, target)).toBe(false)
	})
})
