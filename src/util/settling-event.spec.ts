import { describe, expect, it } from 'vitest'
import { dispatchSettling } from './settling-event'

describe('dispatchSettling', () => {
	it('returns the promise a handler passes to waitUntil and carries the detail', () => {
		const host = document.createElement('div')
		const work = Promise.resolve()
		let seen: unknown
		host.addEventListener('ping', (e) => {
			const detail = (e as CustomEvent).detail
			seen = detail.id
			detail.waitUntil(work)
		})
		expect(dispatchSettling(host, 'ping', { id: 7 })).toBe(work)
		expect(seen).toBe(7)
	})

	it('returns undefined when nobody waits, and bubbles', () => {
		const parent = document.createElement('div')
		const host = document.createElement('span')
		parent.append(host)
		let bubbled = false
		parent.addEventListener('ping', () => {
			bubbled = true
		})
		expect(dispatchSettling(host, 'ping')).toBeUndefined()
		expect(bubbled).toBe(true)
	})
})
