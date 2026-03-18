import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type BubbleArtistClient,
	BubbleManager,
} from '../../../src/routes/discovery/bubble-manager'
import type { ArtistBubble } from '../../../src/services/artist-service-client'
import { createMockLogger } from '../../../test/helpers/mock-logger'

function makeBubble(id: string, name: string): ArtistBubble {
	return { id, name, mbid: '', imageUrl: '', x: 0, y: 0, radius: 30 }
}

function createMockCanvas() {
	return {
		bubbleCount: 0,
		canvasRect: { width: 400, height: 600 },
		spawnBubblesAt: vi.fn(),
		spawnAndAbsorb: vi.fn(),
		fadeOutBubbles: vi.fn().mockResolvedValue(undefined),
		reloadBubbles: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
	} as any
}

describe('BubbleManager', () => {
	let sut: BubbleManager
	let mockClient: BubbleArtistClient
	let followedIds: Set<string>

	beforeEach(() => {
		mockClient = {
			listTop: vi.fn().mockResolvedValue([]),
			listSimilar: vi.fn().mockResolvedValue([]),
		}

		followedIds = new Set<string>()
		sut = new BubbleManager(mockClient, createMockLogger(), () => followedIds)
	})

	describe('loadInitialArtists', () => {
		it('should call listTop when no followed artists', async () => {
			const bubbles = [makeBubble('a1', 'Artist One')]
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				bubbles,
			)

			await sut.loadInitialArtists([], 'Japan', '')

			expect(mockClient.listTop).toHaveBeenCalledWith('Japan', '', 50)
			expect(sut.poolBubbles).toHaveLength(1)
		})

		it('should call listSimilar when followed artists exist', async () => {
			const followed = [makeBubble('f1', 'Followed')]
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('s1', 'Similar'),
			])

			await sut.loadInitialArtists(followed, 'Japan', '')

			expect(mockClient.listSimilar).toHaveBeenCalled()
			expect(sut.poolBubbles).toHaveLength(1)
		})

		it('should deduplicate against followed artists', async () => {
			const followed = [makeBubble('f1', 'Followed')]
			const similar = [makeBubble('f1', 'Followed'), makeBubble('a1', 'New')]
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(
				similar,
			)

			await sut.loadInitialArtists(followed, 'Japan', '')

			// 'Followed' should be excluded since it's tracked as seen
			expect(sut.poolBubbles).toHaveLength(1)
			expect(sut.poolBubbles[0].id).toBe('a1')
		})
	})

	describe('onNeedMoreBubbles', () => {
		it('should fetch similar and spawn them', async () => {
			const similar = [makeBubble('s1', 'Similar')]
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(
				similar,
			)

			const canvas = createMockCanvas()
			const result = await sut.onNeedMoreBubbles(
				'a1',
				'Artist',
				{ x: 50, y: 50 },
				canvas,
			)

			expect(result).toBe(true)
			expect(mockClient.listSimilar).toHaveBeenCalledWith('a1', 30)
			expect(canvas.spawnBubblesAt).toHaveBeenCalledWith(similar, 50, 50)
		})

		it('should fall back to top artists when similar is empty', async () => {
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('t1', 'Top'),
			])

			const canvas = createMockCanvas()
			await sut.onNeedMoreBubbles('a1', 'NoSimilar', { x: 0, y: 0 }, canvas)

			expect(mockClient.listTop).toHaveBeenCalled()
			expect(canvas.spawnBubblesAt).toHaveBeenCalled()
		})

		it('should evict oldest when pool is full', async () => {
			// Fill the pool
			const initial = Array.from({ length: 50 }, (_, i) =>
				makeBubble(`e${i}`, `Existing ${i}`),
			)
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue(
				initial,
			)
			await sut.loadInitialArtists([], 'Japan', '')

			// Now add more
			const similar = [makeBubble('new1', 'New One')]
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(
				similar,
			)

			const canvas = createMockCanvas()
			canvas.bubbleCount = 50

			await sut.onNeedMoreBubbles('a1', 'Source', { x: 0, y: 0 }, canvas)

			expect(canvas.fadeOutBubbles).toHaveBeenCalled()
		})

		it('should ignore concurrent requests', async () => {
			let resolveFirst: (value: ArtistBubble[]) => void
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockReturnValueOnce(
				new Promise<ArtistBubble[]>((resolve) => {
					resolveFirst = resolve
				}),
			)

			const canvas = createMockCanvas()
			const first = sut.onNeedMoreBubbles('a1', 'A', { x: 0, y: 0 }, canvas)
			const second = sut.onNeedMoreBubbles('a2', 'B', { x: 0, y: 0 }, canvas)

			resolveFirst!([makeBubble('s1', 'S1')])
			await first
			const secondResult = await second

			expect(secondResult).toBe(false)
			expect(mockClient.listSimilar).toHaveBeenCalledTimes(1)
		})

		it('should return false when no new bubbles available', async () => {
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(
				[],
			)
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([])

			const canvas = createMockCanvas()
			const result = await sut.onNeedMoreBubbles(
				'a1',
				'NoResults',
				{ x: 0, y: 0 },
				canvas,
			)

			expect(result).toBe(false)
		})
	})

	describe('spawnAndAbsorbAfterSearch', () => {
		it('should defer canvas read via requestAnimationFrame', () => {
			const canvas = createMockCanvas()
			const rafSpy = vi
				.spyOn(globalThis, 'requestAnimationFrame')
				.mockImplementation((cb) => {
					cb(0)
					return 0
				})

			sut.spawnAndAbsorbAfterSearch(makeBubble('a1', 'Artist'), canvas)

			expect(rafSpy).toHaveBeenCalled()
			expect(canvas.spawnAndAbsorb).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1' }),
				200, // 400 / 2
				expect.closeTo(102, 0), // 600 * 0.17
			)

			rafSpy.mockRestore()
		})

		it('should skip absorption when canvas has zero dimensions', () => {
			const canvas = createMockCanvas()
			canvas.canvasRect = { width: 0, height: 0 }

			const rafSpy = vi
				.spyOn(globalThis, 'requestAnimationFrame')
				.mockImplementation((cb) => {
					cb(0)
					return 0
				})

			sut.spawnAndAbsorbAfterSearch(makeBubble('a1', 'Artist'), canvas)

			expect(canvas.spawnAndAbsorb).not.toHaveBeenCalled()

			rafSpy.mockRestore()
		})
	})

	describe('pool state sync', () => {
		it('should reflect pool state through poolBubbles', async () => {
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a1', 'One'),
				makeBubble('a2', 'Two'),
			])

			await sut.loadInitialArtists([], 'Japan', '')

			expect(sut.poolBubbles).toHaveLength(2)
		})
	})

	describe('dedup uses external followedIds', () => {
		it('should exclude followed artists from loadInitialArtists', async () => {
			followedIds.add('a1')
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a1', 'Followed'),
				makeBubble('a2', 'Available'),
			])

			await sut.loadInitialArtists([], 'Japan', '')

			expect(sut.poolBubbles).toHaveLength(1)
			expect(sut.poolBubbles[0].id).toBe('a2')
		})

		it('should use latest followedIds at call time (lazy evaluation)', async () => {
			;(mockClient.listTop as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a1', 'One'),
				makeBubble('a2', 'Two'),
			])

			// followedIds is empty at construction time
			await sut.loadInitialArtists([], 'Japan', '')
			expect(sut.poolBubbles).toHaveLength(2)

			// Update followedIds after construction
			followedIds.add('a3')
			;(mockClient.listSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
				makeBubble('a3', 'Now Followed'),
				makeBubble('a4', 'Still Available'),
			])

			const canvas = createMockCanvas()
			await sut.onNeedMoreBubbles('a1', 'One', { x: 0, y: 0 }, canvas)

			// a3 should be filtered out because followedIds was updated
			const spawnedBubbles = canvas.spawnBubblesAt.mock.calls[0]?.[0] ?? []
			const spawnedIds = spawnedBubbles.map((b: ArtistBubble) => b.id)
			expect(spawnedIds).not.toContain('a3')
			expect(spawnedIds).toContain('a4')
		})
	})
})
