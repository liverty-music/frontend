import { describe, expect, it } from 'vitest'
import type { ArtistBubble } from '../../src/services/artist-service-client'
import { BubblePool } from '../../src/services/bubble-pool'

function makeBubble(id: string, name: string, mbid = ''): ArtistBubble {
	return { id, name, mbid, imageUrl: '', x: 0, y: 0, radius: 40 }
}

describe('BubblePool', () => {
	describe('add', () => {
		it('should add bubbles to the pool', () => {
			const pool = new BubblePool()
			const bubbles = [makeBubble('a1', 'One'), makeBubble('a2', 'Two')]

			const evictedIds = pool.add(bubbles)

			expect(evictedIds).toHaveLength(0)
			expect(pool.availableBubbles).toHaveLength(2)
		})

		it('should evict oldest bubbles when exceeding MAX_BUBBLES', () => {
			const pool = new BubblePool()
			const initial = Array.from({ length: BubblePool.MAX_BUBBLES }, (_, i) =>
				makeBubble(`a${i}`, `Artist ${i}`),
			)
			pool.add(initial)

			expect(pool.availableBubbles).toHaveLength(BubblePool.MAX_BUBBLES)

			const newBubbles = Array.from({ length: 5 }, (_, i) =>
				makeBubble(`new${i}`, `New ${i}`),
			)

			const evictedIds = pool.add(newBubbles)

			expect(evictedIds).toHaveLength(5)
			expect(evictedIds[0]).toBe('a0')
			expect(evictedIds[4]).toBe('a4')
			expect(pool.availableBubbles).toHaveLength(BubblePool.MAX_BUBBLES)
			expect(pool.availableBubbles[pool.availableBubbles.length - 1].name).toBe(
				'New 4',
			)
		})

		it('should reassign array reference for Aurelia observation', () => {
			const pool = new BubblePool()
			const before = pool.availableBubbles
			pool.add([makeBubble('a1', 'One')])
			expect(pool.availableBubbles).not.toBe(before)
		})

		it('should return empty array when no eviction needed', () => {
			const pool = new BubblePool()
			const evictedIds = pool.add([makeBubble('a1', 'One')])
			expect(evictedIds).toHaveLength(0)
		})
	})

	describe('remove', () => {
		it('should remove an artist from the pool', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One'), makeBubble('a2', 'Two')])

			pool.remove('a1')

			expect(pool.availableBubbles).toHaveLength(1)
			expect(pool.availableBubbles[0].id).toBe('a2')
		})

		it('should be a no-op when artist is not in pool', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One')])

			pool.remove('nonexistent')

			expect(pool.availableBubbles).toHaveLength(1)
		})
	})

	describe('evictOldest', () => {
		it('should remove and return the oldest N bubbles', () => {
			const pool = new BubblePool()
			pool.add([
				makeBubble('a1', 'One'),
				makeBubble('a2', 'Two'),
				makeBubble('a3', 'Three'),
			])

			const evicted = pool.evictOldest(2)

			expect(evicted).toHaveLength(2)
			expect(evicted[0].id).toBe('a1')
			expect(evicted[1].id).toBe('a2')
			expect(pool.availableBubbles).toHaveLength(1)
			expect(pool.availableBubbles[0].id).toBe('a3')
		})

		it('should return empty array when count is 0', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One')])

			const evicted = pool.evictOldest(0)

			expect(evicted).toHaveLength(0)
			expect(pool.availableBubbles).toHaveLength(1)
		})

		it('should reassign array reference for Aurelia observation', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One'), makeBubble('a2', 'Two')])
			const before = pool.availableBubbles

			pool.evictOldest(1)

			expect(pool.availableBubbles).not.toBe(before)
		})
	})

	describe('replace', () => {
		it('should replace the entire pool', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One')])

			pool.replace([makeBubble('b1', 'New One'), makeBubble('b2', 'New Two')])

			expect(pool.availableBubbles).toHaveLength(2)
			expect(pool.availableBubbles[0].id).toBe('b1')
		})
	})

	describe('reset', () => {
		it('should clear pool, seen sets, and followed IDs', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One')])
			pool.trackSeen(makeBubble('a1', 'One'))
			pool.markFollowed('a1')

			pool.reset()

			expect(pool.availableBubbles).toHaveLength(0)
			expect(pool.isFollowed('a1')).toBe(false)
			// Seen sets cleared: dedup should no longer filter
			const result = pool.dedup([makeBubble('a1', 'One')])
			expect(result).toHaveLength(1)
		})
	})

	describe('markFollowed / unmarkFollowed / isFollowed', () => {
		it('should mark an artist as followed and remove from pool', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One'), makeBubble('a2', 'Two')])

			pool.markFollowed('a1')

			expect(pool.isFollowed('a1')).toBe(true)
			expect(pool.followedIds.has('a1')).toBe(true)
			expect(pool.availableBubbles).toHaveLength(1)
			expect(pool.availableBubbles[0].id).toBe('a2')
		})

		it('should unmark a followed artist for rollback', () => {
			const pool = new BubblePool()
			pool.markFollowed('a1')

			pool.unmarkFollowed('a1')

			expect(pool.isFollowed('a1')).toBe(false)
			expect(pool.followedIds.has('a1')).toBe(false)
		})

		it('should be a no-op when marking already followed artist', () => {
			const pool = new BubblePool()
			pool.add([makeBubble('a1', 'One')])
			pool.markFollowed('a1')
			pool.markFollowed('a1')

			expect(pool.isFollowed('a1')).toBe(true)
			expect(pool.availableBubbles).toHaveLength(0)
		})
	})

	describe('dedup', () => {
		it('should filter out seen artists by name', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeBubble('a1', 'Artist X'))

			const result = pool.dedup([
				makeBubble('a2', 'Artist X'), // same name, different id
				makeBubble('a3', 'Artist Y'),
			])

			expect(result).toHaveLength(1)
			expect(result[0].name).toBe('Artist Y')
		})

		it('should filter out seen artists by id', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeBubble('a1', 'Original Name'))

			const result = pool.dedup([
				makeBubble('a1', 'Different Name'),
				makeBubble('a2', 'New Artist'),
			])

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a2')
		})

		it('should filter out seen artists by mbid', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeBubble('a1', 'Artist', 'mbid-123'))

			const result = pool.dedup([
				makeBubble('a2', 'Different', 'mbid-123'), // same mbid
				makeBubble('a3', 'Other', 'mbid-456'),
			])

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a3')
		})

		it('should filter out followed artists', () => {
			const pool = new BubblePool()
			pool.markFollowed('a1')

			const result = pool.dedup([
				makeBubble('a1', 'Followed Artist'),
				makeBubble('a2', 'Not Followed'),
			])

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a2')
		})

		it('should normalize name matching (case-insensitive, whitespace-collapsed)', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeBubble('a1', 'Artist  X'))

			const result = pool.dedup([makeBubble('a2', ' artist x ')])

			expect(result).toHaveLength(0)
		})
	})

	describe('trackSeen / trackAllSeen', () => {
		it('should track multiple bubbles as seen', () => {
			const pool = new BubblePool()
			pool.trackAllSeen([makeBubble('a1', 'One'), makeBubble('a2', 'Two')])

			const result = pool.dedup([
				makeBubble('a1', 'One'),
				makeBubble('a2', 'Two'),
				makeBubble('a3', 'Three'),
			])

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a3')
		})
	})

	describe('resetSeenWith', () => {
		it('should clear seen sets and re-seed from provided bubbles', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeBubble('old1', 'Old One'))

			pool.resetSeenWith([makeBubble('keep1', 'Keep One')])

			// Old seen artist should no longer be filtered
			const result1 = pool.dedup([makeBubble('old1', 'Old One')])
			expect(result1).toHaveLength(1)

			// Kept artist should still be filtered
			const result2 = pool.dedup([makeBubble('keep1', 'Keep One')])
			expect(result2).toHaveLength(0)
		})
	})

	describe('clearSeenSets', () => {
		it('should clear all seen tracking', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeBubble('a1', 'One'))

			pool.clearSeenSets()

			const result = pool.dedup([makeBubble('a1', 'One')])
			expect(result).toHaveLength(1)
		})
	})

	describe('maxBubbles', () => {
		it('should return MAX_BUBBLES constant', () => {
			const pool = new BubblePool()
			expect(pool.maxBubbles).toBe(BubblePool.MAX_BUBBLES)
		})
	})
})
