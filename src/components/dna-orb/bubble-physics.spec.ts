// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { Artist } from '../../entities/artist'
import { MAX_BUBBLES } from '../../services/bubble-invariants'
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

// Physics only creates bodies after init() loads Matter — addBubbles/spawnBubblesAt
// no-op before then (they must never store bodyless bubbles).
async function mkPhysics(): Promise<BubblePhysics> {
	const physics = new BubblePhysics()
	await physics.init(400, 600)
	return physics
}

describe('BubblePhysics.reconcile', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Reconcile to a target list"
	it('adds new target artists and fades out stale ones', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(params(['a', 'b', 'c']))

		const dropped = physics.reconcile(params(['b', 'c', 'd']))

		expect(dropped).toBe(0)
		expect(liveIds(physics)).toEqual(['b', 'c', 'd'])
		const stale = physics.getBubbles().find((b) => b.artist.id === 'a')
		expect(stale?.isFadingOut).toBe(true)
	})

	it('keeps matching bodies in place without recreating them', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(params(['a', 'b']))
		const before = physics.getBubbles().find((b) => b.artist.id === 'a')

		physics.reconcile(params(['a', 'b']))

		const after = physics.getBubbles().find((b) => b.artist.id === 'a')
		expect(after).toBe(before)
		expect(liveIds(physics)).toEqual(['a', 'b'])
	})

	// @spec components/infrastructure/fan/web/route/discovery "Stale bodies removed on artist set replacement"
	it('preserves render parity across a background refresh to a disjoint field', async () => {
		const physics = await mkPhysics()
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

	it('revives a mid-fade target member re-added within the fade window instead of dropping it', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(params(['a', 'b']))

		// reconcile #1: 'a' leaves the target and starts fading (still in bubbleMap).
		physics.reconcile(params(['b']))
		const fading = physics.getBubbles().find((x) => x.artist.id === 'a')
		expect(fading?.isFadingOut).toBe(true)

		// reconcile #2 within the fade window: 'a' is back — it must be revived in
		// place, not skipped and later deleted by update() (silent divergence).
		const dropped = physics.reconcile(params(['a', 'b']))
		expect(dropped).toBe(0)
		const revived = physics.getBubbles().find((x) => x.artist.id === 'a')
		expect(revived).toBe(fading)
		expect(revived?.isFadingOut).toBe(false)

		// After fades flush, 'a' survives in the field.
		physics.update(1000)
		expect(liveIds(physics)).toEqual(['a', 'b'])
	})

	// @spec components/infrastructure/fan/web/route/discovery "Fading-out bodies do not block replacements"
	it('does not let fading-out bodies block replacements up to the cap', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(params(ids('old', MAX_BUBBLES)))

		const dropped = physics.reconcile(params(ids('new', MAX_BUBBLES)))

		expect(dropped).toBe(0)
		expect(liveIds(physics)).toHaveLength(MAX_BUBBLES)
		physics.update(1000)
		expect(physics.bubbleCount).toBe(MAX_BUBBLES)
	})

	it('spawns a placed new target from its placement point with the pop animation', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(params(['a']))

		// 'b' is added with a placement hint (a tap top-up); it must spawn (scale
		// from zero) from the given point rather than appear instantly at random.
		physics.reconcile(params(['a', 'b']), {
			placements: new Map([['b', { x: 123, y: 45 }]]),
		})

		const b = physics.getBubbles().find((x) => x.artist.id === 'b')
		expect(b?.isSpawning).toBe(true)
		expect(b?.body.position.x).toBeCloseTo(123)
		expect(b?.body.position.y).toBeCloseTo(45)
		// An unplaced add stays instant (no spawn animation).
		const a = physics.getBubbles().find((x) => x.artist.id === 'a')
		expect(a?.isSpawning).toBe(false)
	})
})

describe('BubblePhysics.addBubbles capacity', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Physics never silently drops a target member"
	it('caps live bodies at MAX and reports the dropped count instead of silently truncating', async () => {
		const physics = await mkPhysics()

		const dropped = physics.addBubbles(params(ids('x', MAX_BUBBLES + 10)))

		expect(physics.bubbleCount).toBe(MAX_BUBBLES)
		expect(dropped).toBe(10)
	})
})

describe('BubblePhysics init guard (regression #526)', () => {
	it('addBubbles no-ops before init — never stores a bodyless bubble', () => {
		const physics = new BubblePhysics() // not initialized → Matter is null
		const dropped = physics.addBubbles(params(['a', 'b']))
		expect(physics.bubbleCount).toBe(0)
		expect(dropped).toBe(0)
	})

	it('spawnBubblesAt no-ops before init', () => {
		const physics = new BubblePhysics()
		physics.spawnBubblesAt(params(['a']), 10, 20)
		expect(physics.bubbleCount).toBe(0)
	})

	it('paints real bodies once init has run', async () => {
		const physics = new BubblePhysics()
		physics.addBubbles(params(['a', 'b'])) // pre-init: dropped
		expect(physics.bubbleCount).toBe(0)

		await physics.init(400, 600)
		physics.addBubbles(params(['a', 'b'])) // post-init: real bodies
		expect(physics.bubbleCount).toBe(2)
		expect(physics.getBubbles().every((b) => b.body?.position)).toBe(true)
	})
})

function ghostParams(n: number): BubbleArtistParams[] {
	return Array.from({ length: n }, (_, i) => ({
		artist: { id: `__ghost__${i}`, name: '', mbid: '', isGhost: true },
		radius: 30,
	}))
}

function liveGhostCount(physics: BubblePhysics): number {
	return physics.getBubbles().filter((b) => b.artist.isGhost && !b.isFadingOut)
		.length
}

describe('ghost placeholders ignore taps', () => {
	// @spec components/infrastructure/fan/web/route/discovery "Tap on a ghost"
	it('finds no bubble under a tap on a ghost, so nothing is followed or requested', () => {
		const g = mockBubble('__ghost__0', 100, 100, 40)
		g.artist = { id: '__ghost__0', name: '', mbid: '', isGhost: true }
		expect(findClosestBubble([g], 100, 100)).toBeUndefined()
	})

	// @spec components/infrastructure/fan/web/route/discovery "Tap on a revealed artist while other bubbles are still ghosts"
	it('finds a revealed artist under a tap even when a ghost overlaps it', () => {
		const g = mockBubble('__ghost__0', 100, 100, 40)
		g.artist = { id: '__ghost__0', name: '', mbid: '', isGhost: true }
		const a = mockBubble('A', 120, 100, 40)
		// The ghost's center is closer to the tap, but only the artist responds.
		expect(findClosestBubble([g, a], 102, 100)?.artist.id).toBe('A')
	})
})

describe('BubblePhysics.reconcile keepGhosts (progressive reveal)', () => {
	it('spawns real members in ghost slots and keeps the remaining ghosts', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(ghostParams(10))
		const slot = physics.getBubbles()[0]

		physics.reconcile(params(['a', 'b']), { keepGhosts: true })

		expect(physics.bubbleCount).toBe(10)
		expect(liveGhostCount(physics)).toBe(8)
		const a = physics.getBubbles().find((b) => b.artist.id === 'a')
		// The artist took a ghost body in place, with the spawn animation.
		expect(a).toBe(slot)
		expect(a?.isSpawning).toBe(true)

		// A later partial field keeps the earlier artists' bodies and fills more
		// ghost slots.
		physics.reconcile(params(['a', 'b', 'c']), { keepGhosts: true })
		expect(physics.getBubbles().find((b) => b.artist.id === 'a')).toBe(slot)
		expect(physics.bubbleCount).toBe(10)
		expect(liveGhostCount(physics)).toBe(7)
	})

	it('fades out the leftover ghosts once the field is all real', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(ghostParams(10))
		physics.reconcile(params(['a', 'b']), { keepGhosts: true })

		physics.reconcile(params(['a', 'b', 'c']))

		expect(liveGhostCount(physics)).toBe(0)
		physics.update(1000)
		expect(liveIds(physics)).toEqual(['a', 'b', 'c'])
		expect(physics.bubbleCount).toBe(3)
	})

	it('adds real members beyond the ghost slots as new bodies', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(ghostParams(2))

		physics.reconcile(params(['a', 'b', 'c']), { keepGhosts: true })

		expect(liveIds(physics)).toEqual(['a', 'b', 'c'])
		expect(liveGhostCount(physics)).toBe(0)
	})
})

const LABEL_THRESHOLD = 0.55

describe('revealed names fade in on real time', () => {
	const PHYSICS_CAP = 32

	// Elapsed real time until a ghost switched to a real artist has its name
	// drawn, with frames arriving every `frameMs` and the canvas' capped delta.
	async function msUntilNameDrawn(frameMs: number): Promise<number> {
		const physics = await mkPhysics()
		physics.addBubbles(ghostParams(1))
		physics.reconcile(params(['a']))
		const bubble = physics.getBubbles().find((b) => b.artist.id === 'a')
		let elapsed = 0
		while ((bubble?.opacity ?? 0) <= LABEL_THRESHOLD && elapsed < 5000) {
			physics.update(Math.min(frameMs, PHYSICS_CAP), frameMs)
			elapsed += frameMs
		}
		return elapsed
	}

	// @spec components/infrastructure/fan/web/route/discovery "Normal frame rate"
	it('draws the name within 300 ms at 16 ms frames', async () => {
		expect(await msUntilNameDrawn(16)).toBeLessThanOrEqual(300)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Slow frames"
	it('draws the name within 300 ms at 100 ms frames, not after the capped time', async () => {
		expect(await msUntilNameDrawn(100)).toBeLessThanOrEqual(300)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Reduced motion"
	it('reveals on the same real-time bound with reduced motion', async () => {
		// Reduced motion only changes the tap and absorption effects
		// (DnaOrbCanvas.applyReducedMotion); BubblePhysics takes no reduced-motion
		// input, so the reveal runs this same update at both settings.
		expect(await msUntilNameDrawn(16)).toBeLessThanOrEqual(300)
		expect(await msUntilNameDrawn(100)).toBeLessThanOrEqual(300)
	})

	it('keeps the physics step capped while the spawn uses real time', async () => {
		const physics = await mkPhysics()
		physics.spawnBubblesAt(params(['a']), 100, 100)
		const bubble = physics.getBubbles().find((b) => b.artist.id === 'a')

		physics.update(32, 100)

		expect(bubble?.spawnProgress).toBeCloseTo(0.3)
	})

	it('reveals a ghost in place: full size, fading up from the ghost opacity', async () => {
		const physics = await mkPhysics()
		physics.addBubbles(ghostParams(1))
		physics.reconcile(params(['a']))
		const bubble = physics.getBubbles().find((b) => b.artist.id === 'a')

		expect(bubble?.scale).toBe(1)
		expect(bubble?.opacity).toBeCloseTo(0.35)
		let elapsed = 0
		while ((bubble?.opacity ?? 0) <= LABEL_THRESHOLD) {
			physics.update(16, 16)
			elapsed += 16
			expect(bubble?.scale).toBe(1)
		}
		// The name is drawn within a few frames of the swap.
		expect(elapsed).toBeLessThanOrEqual(64)
		physics.update(16, 200)
		expect(bubble?.isSpawning).toBe(false)
		expect(bubble?.opacity).toBe(1)
	})

	it('keeps the pop-in spawn for a bubble added from a tap', async () => {
		const physics = await mkPhysics()
		physics.spawnBubblesAt(params(['a']), 100, 100)
		const bubble = physics.getBubbles().find((b) => b.artist.id === 'a')

		expect(bubble?.scale).toBe(0)
		expect(bubble?.revealInPlace).toBeFalsy()
	})
})
