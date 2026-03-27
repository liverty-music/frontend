// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { Artist } from '../../src/entities/artist'
import { BubblePool } from '../../src/services/bubble-pool'

function makeArtist(id: string, name: string, mbid = ''): Artist {
	return { id, name, mbid }
}

describe('BubblePool', () => {
	describe('add', () => {
		it('should add bubbles to the pool', () => {
			const pool = new BubblePool()
			const artists = [makeArtist('a1', 'One'), makeArtist('a2', 'Two')]

			const evictedIds = pool.add(artists)

			expect(evictedIds).toHaveLength(0)
			expect(pool.availableBubbles).toHaveLength(2)
		})

		it('should evict oldest bubbles when exceeding MAX_BUBBLES', () => {
			const pool = new BubblePool()
			const initial = Array.from({ length: BubblePool.MAX_BUBBLES }, (_, i) =>
				makeArtist(`a${i}`, `Artist ${i}`),
			)
			pool.add(initial)

			expect(pool.availableBubbles).toHaveLength(BubblePool.MAX_BUBBLES)

			const newArtists = Array.from({ length: 5 }, (_, i) =>
				makeArtist(`new${i}`, `New ${i}`),
			)

			const evictedIds = pool.add(newArtists)

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
			pool.add([makeArtist('a1', 'One')])
			expect(pool.availableBubbles).not.toBe(before)
		})

		it('should return empty array when no eviction needed', () => {
			const pool = new BubblePool()
			const evictedIds = pool.add([makeArtist('a1', 'One')])
			expect(evictedIds).toHaveLength(0)
		})
	})

	describe('remove', () => {
		it('should remove an artist from the pool', () => {
			const pool = new BubblePool()
			pool.add([makeArtist('a1', 'One'), makeArtist('a2', 'Two')])

			pool.remove('a1')

			expect(pool.availableBubbles).toHaveLength(1)
			expect(pool.availableBubbles[0].id).toBe('a2')
		})

		it('should be a no-op when artist is not in pool', () => {
			const pool = new BubblePool()
			pool.add([makeArtist('a1', 'One')])

			pool.remove('nonexistent')

			expect(pool.availableBubbles).toHaveLength(1)
		})
	})

	describe('evictOldest', () => {
		it('should remove and return the oldest N bubbles', () => {
			const pool = new BubblePool()
			pool.add([
				makeArtist('a1', 'One'),
				makeArtist('a2', 'Two'),
				makeArtist('a3', 'Three'),
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
			pool.add([makeArtist('a1', 'One')])

			const evicted = pool.evictOldest(0)

			expect(evicted).toHaveLength(0)
			expect(pool.availableBubbles).toHaveLength(1)
		})

		it('should reassign array reference for Aurelia observation', () => {
			const pool = new BubblePool()
			pool.add([makeArtist('a1', 'One'), makeArtist('a2', 'Two')])
			const before = pool.availableBubbles

			pool.evictOldest(1)

			expect(pool.availableBubbles).not.toBe(before)
		})
	})

	describe('replace', () => {
		it('should replace the entire pool', () => {
			const pool = new BubblePool()
			pool.add([makeArtist('a1', 'One')])

			pool.replace([makeArtist('b1', 'New One'), makeArtist('b2', 'New Two')])

			expect(pool.availableBubbles).toHaveLength(2)
			expect(pool.availableBubbles[0].id).toBe('b1')
		})
	})

	describe('reset', () => {
		it('should clear pool and seen sets', () => {
			const pool = new BubblePool()
			pool.add([makeArtist('a1', 'One')])
			pool.trackSeen(makeArtist('a1', 'One'))

			pool.reset()
			expect(pool.availableBubbles).toHaveLength(0)
			// Seen sets cleared: dedup should no longer filter
			const result = pool.dedup([makeArtist('a1', 'One')], new Set())
			expect(result).toHaveLength(1)
		})
	})

	describe('dedup', () => {
		it('should filter out seen artists by name', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('a1', 'Artist X'))

			const result = pool.dedup(
				[
					makeArtist('a2', 'Artist X'), // same name, different id
					makeArtist('a3', 'Artist Y'),
				],
				new Set(),
			)

			expect(result).toHaveLength(1)
			expect(result[0].name).toBe('Artist Y')
		})

		it('should filter out seen artists by id', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('a1', 'Original Name'))

			const result = pool.dedup(
				[makeArtist('a1', 'Different Name'), makeArtist('a2', 'New Artist')],
				new Set(),
			)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a2')
		})

		it('should filter out seen artists by mbid', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('a1', 'Artist', 'mbid-123'))

			const result = pool.dedup(
				[
					makeArtist('a2', 'Different', 'mbid-123'), // same mbid
					makeArtist('a3', 'Other', 'mbid-456'),
				],
				new Set(),
			)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a3')
		})

		it('should filter out followed artists via external followedIds', () => {
			const pool = new BubblePool()
			const followedIds = new Set(['a1'])

			const result = pool.dedup(
				[makeArtist('a1', 'Followed Artist'), makeArtist('a2', 'Not Followed')],
				followedIds,
			)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a2')
		})

		it('should work without follow filtering when followedIds is empty', () => {
			const pool = new BubblePool()

			const result = pool.dedup(
				[makeArtist('a1', 'Artist One'), makeArtist('a2', 'Artist Two')],
				new Set(),
			)

			expect(result).toHaveLength(2)
		})

		it('should apply both seen and followed filters', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('a1', 'Seen Artist'))
			const followedIds = new Set(['a2'])

			const result = pool.dedup(
				[
					makeArtist('a1', 'Seen Artist'),
					makeArtist('a2', 'Followed Artist'),
					makeArtist('a3', 'Fresh Artist'),
				],
				followedIds,
			)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a3')
		})

		it('should normalize name matching (case-insensitive, whitespace-collapsed)', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('a1', 'Artist  X'))

			const result = pool.dedup([makeArtist('a2', ' artist x ')], new Set())

			expect(result).toHaveLength(0)
		})
	})

	describe('trackSeen / trackAllSeen', () => {
		it('should track multiple bubbles as seen', () => {
			const pool = new BubblePool()
			pool.trackAllSeen([makeArtist('a1', 'One'), makeArtist('a2', 'Two')])

			const result = pool.dedup(
				[
					makeArtist('a1', 'One'),
					makeArtist('a2', 'Two'),
					makeArtist('a3', 'Three'),
				],
				new Set(),
			)

			expect(result).toHaveLength(1)
			expect(result[0].id).toBe('a3')
		})
	})

	describe('resetSeenWith', () => {
		it('should clear seen sets and re-seed from provided bubbles', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('old1', 'Old One'))

			pool.resetSeenWith([makeArtist('keep1', 'Keep One')])

			// Old seen artist should no longer be filtered
			const result1 = pool.dedup([makeArtist('old1', 'Old One')], new Set())
			expect(result1).toHaveLength(1)

			// Kept artist should still be filtered
			const result2 = pool.dedup([makeArtist('keep1', 'Keep One')], new Set())
			expect(result2).toHaveLength(0)
		})
	})

	describe('clearSeenSets', () => {
		it('should clear all seen tracking', () => {
			const pool = new BubblePool()
			pool.trackSeen(makeArtist('a1', 'One'))

			pool.clearSeenSets()

			const result = pool.dedup([makeArtist('a1', 'One')], new Set())
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
