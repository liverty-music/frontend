// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { Artist } from '../../entities/artist'
import { BubblePool } from '../../services/bubble-pool'
import type { BubbleArtistParams, PhysicsBubble } from './bubble-physics'
import { BubblePhysics, findClosestBubble } from './bubble-physics'

function mockBubble(
	id: string,
	x: number,
	y: number,
	radius: number,
	scale = 1,
	isFadingOut = false,
): PhysicsBubble {
	return {
		body: { position: { x, y } },
		artist: { id, name: id, mbid: '' },
		radius,
		scale,
		opacity: isFadingOut ? 0.5 : 1,
		isSpawning: false,
		spawnProgress: 1,
		isFadingOut,
		fadeOutProgress: 0,
	} as PhysicsBubble
}

describe('findClosestBubble', () => {
	it('returns the bubble when tap is inside its radius', () => {
		const a = mockBubble('A', 100, 100, 40)
		expect(findClosestBubble([a], 100, 100)?.artist.id).toBe('A')
	})

	it('returns the bubble when tap is at the edge of radius', () => {
		const a = mockBubble('A', 100, 100, 40)
		expect(findClosestBubble([a], 139, 100)?.artist.id).toBe('A')
	})

	it('returns undefined when tap is outside radius', () => {
		const a = mockBubble('A', 100, 100, 40)
		expect(findClosestBubble([a], 141, 100)).toBeUndefined()
	})

	it('returns the closest bubble when two overlap at tap point', () => {
		// A at x=100, B at x=130, both r=40 → overlap zone around x=110-130
		const a = mockBubble('A', 100, 100, 40)
		const b = mockBubble('B', 130, 100, 40)
		// Tap at x=118 → dist to A=18, dist to B=12 → B is closer
		expect(findClosestBubble([a, b], 118, 100)?.artist.id).toBe('B')
	})

	it('returns the closest among three densely packed bubbles', () => {
		const a = mockBubble('A', 100, 100, 40)
		const b = mockBubble('B', 110, 100, 35)
		const c = mockBubble('C', 90, 110, 30)
		// Tap at (105, 105): dist to A=~7.07, B=~7.07, C=~15.8
		// Both A and B are within radius, but B has r=35 so check hit:
		// dist to B center = sqrt(25+25)=~7.07 <= 35 ✓
		// dist to A center = sqrt(25+25)=~7.07 <= 40 ✓
		// Both hit, equal distance → first found wins (A), but let's use a clearer case
		// Tap at (108, 100): dist to A=8, dist to B=2 → B is closer
		expect(findClosestBubble([a, b, c], 108, 100)?.artist.id).toBe('B')
	})

	it('excludes fading-out bubbles', () => {
		const a = mockBubble('A', 100, 100, 40, 1, true)
		expect(findClosestBubble([a], 100, 100)).toBeUndefined()
	})

	it('excludes bubbles with scale=0', () => {
		const a = mockBubble('A', 100, 100, 40, 0)
		expect(findClosestBubble([a], 100, 100)).toBeUndefined()
	})

	it('respects scale factor for hit radius', () => {
		const a = mockBubble('A', 100, 100, 40, 0.5) // hit radius = 20
		// Tap at (119, 100) → dist=19 <= 20 ✓
		expect(findClosestBubble([a], 119, 100)?.artist.id).toBe('A')
		// Tap at (121, 100) → dist=21 > 20 ✗
		expect(findClosestBubble([a], 121, 100)).toBeUndefined()
	})

	it('returns undefined for empty array', () => {
		expect(findClosestBubble([], 100, 100)).toBeUndefined()
	})
})

function artist(id: string): Artist {
	return { id, name: id, mbid: '' }
}

function params(ids: string[]): BubbleArtistParams[] {
	return ids.map((id) => ({ artist: artist(id), radius: 30 }))
}

function ids(prefix: string, n: number): string[] {
	return Array.from({ length: n }, (_, i) => `${prefix}${i}`)
}

function liveIds(physics: BubblePhysics): string[] {
	return physics
		.getBubbles()
		.filter((b) => !b.isFadingOut)
		.map((b) => b.artist.id)
		.sort()
}

describe('BubblePhysics.reconcile', () => {
	it('adds new target artists and fades out stale ones', () => {
		const physics = new BubblePhysics()
		physics.addBubbles(params(['a', 'b', 'c']))

		const dropped = physics.reconcile(params(['b', 'c', 'd']))

		expect(dropped).toBe(0)
		expect(liveIds(physics)).toEqual(['b', 'c', 'd'])
		const stale = physics.getBubbles().find((b) => b.artist.id === 'a')
		expect(stale?.isFadingOut).toBe(true)
	})

	it('keeps matching bodies in place without recreating them', () => {
		const physics = new BubblePhysics()
		physics.addBubbles(params(['a', 'b']))
		const before = physics.getBubbles().find((b) => b.artist.id === 'a')

		physics.reconcile(params(['a', 'b']))

		const after = physics.getBubbles().find((b) => b.artist.id === 'a')
		expect(after).toBe(before)
		expect(liveIds(physics)).toEqual(['a', 'b'])
	})

	it('preserves render parity across a background refresh to a disjoint field', () => {
		const physics = new BubblePhysics()
		// Cache paint: 41 real bodies.
		physics.addBubbles(params(ids('old', 41)))
		expect(liveIds(physics)).toHaveLength(41)

		// Background load replaces the field with a disjoint 33-artist set.
		const dropped = physics.reconcile(params(ids('new', 33)))

		// Regression: the 33 new members must NOT be dropped by the 41 still-fading
		// bodies (the prod bug rendered only 16 of 33).
		expect(dropped).toBe(0)
		expect(liveIds(physics)).toEqual(ids('new', 33).sort())

		// After fades flush, exactly the target remains — full render parity.
		physics.update(1000)
		expect(physics.bubbleCount).toBe(33)
		expect(
			physics
				.getBubbles()
				.map((b) => b.artist.id)
				.sort(),
		).toEqual(ids('new', 33).sort())
	})

	it('does not let fading-out bodies block replacements up to the cap', () => {
		const physics = new BubblePhysics()
		physics.addBubbles(params(ids('old', BubblePool.MAX_BUBBLES)))

		const dropped = physics.reconcile(
			params(ids('new', BubblePool.MAX_BUBBLES)),
		)

		expect(dropped).toBe(0)
		expect(liveIds(physics)).toHaveLength(BubblePool.MAX_BUBBLES)
		physics.update(1000)
		expect(physics.bubbleCount).toBe(BubblePool.MAX_BUBBLES)
	})
})

describe('BubblePhysics.addBubbles capacity', () => {
	it('caps live bodies at MAX and reports the dropped count instead of silently truncating', () => {
		const physics = new BubblePhysics()

		const dropped = physics.addBubbles(
			params(ids('x', BubblePool.MAX_BUBBLES + 10)),
		)

		expect(physics.bubbleCount).toBe(BubblePool.MAX_BUBBLES)
		expect(dropped).toBe(10)
	})
})
