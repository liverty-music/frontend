// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { hasFollow } from './follow'

describe('hasFollow', () => {
	it('returns true when artist is already followed', () => {
		const follows = [{ artist: { id: 'a1' } }]
		expect(hasFollow(follows, 'a1')).toBe(true)
	})

	it('returns false when artist is not followed', () => {
		const follows = [{ artist: { id: 'a1' } }]
		expect(hasFollow(follows, 'a2')).toBe(false)
	})

	it('returns false for empty follow list', () => {
		expect(hasFollow([], 'a1')).toBe(false)
	})

	it('finds artist among multiple follows', () => {
		const follows = [
			{ artist: { id: 'a1' } },
			{ artist: { id: 'a2' } },
			{ artist: { id: 'a3' } },
		]
		expect(hasFollow(follows, 'a3')).toBe(true)
	})

	it('returns true when duplicate artist IDs exist', () => {
		const follows = [{ artist: { id: 'a1' } }, { artist: { id: 'a1' } }]
		expect(hasFollow(follows, 'a1')).toBe(true)
	})
})
