import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Artist } from '../../../src/entities/artist'
import {
	type FollowCallbacks,
	type FollowClient,
	type FollowConcertClient,
	FollowOrchestrator,
} from '../../../src/routes/discovery/follow-orchestrator'
import { BubblePool } from '../../../src/services/bubble-pool'
import { createMockLogger } from '../../../test/helpers/mock-logger'

function makeArtist(id: string, name: string): Artist {
	return new Artist({
		id: { value: id },
		name: { value: name },
	})
}

describe('FollowOrchestrator', () => {
	let sut: FollowOrchestrator
	let mockFollowClient: FollowClient
	let mockConcertClient: FollowConcertClient
	let mockCallbacks: FollowCallbacks
	let pool: BubblePool
	let abortController: AbortController

	beforeEach(() => {
		mockFollowClient = {
			follow: vi.fn().mockResolvedValue(undefined),
		}

		mockConcertClient = {
			listConcerts: vi.fn().mockResolvedValue([]),
		}

		mockCallbacks = {
			onFollowed: vi.fn(),
			onRollback: vi.fn(),
			onHasUpcomingEvents: vi.fn(),
			onError: vi.fn(),
			respawnBubble: vi.fn(),
		}

		pool = new BubblePool()
		pool.add([makeArtist('a1', 'Artist One'), makeArtist('a2', 'Artist Two')])
		abortController = new AbortController()

		sut = new FollowOrchestrator(
			mockFollowClient,
			mockConcertClient,
			pool,
			mockCallbacks,
			createMockLogger(),
			() => abortController.signal,
		)
	})

	describe('followArtist', () => {
		it('should follow artist and update state optimistically', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))

			expect(mockFollowClient.follow).toHaveBeenCalledWith('a1', 'Artist One')
			expect(sut.followedCount).toBe(1)
			expect(sut.followedIds.has('a1')).toBe(true)
			expect(mockCallbacks.onFollowed).toHaveBeenCalled()
		})

		it('should skip if artist already followed', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))
			await sut.followArtist(makeArtist('a1', 'Artist One'))

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should rollback on failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network'),
			)

			await expect(
				sut.followArtist(makeArtist('a1', 'Artist One'), { x: 10, y: 20 }),
			).rejects.toThrow('network')

			expect(sut.followedCount).toBe(0)
			expect(sut.followedIds.has('a1')).toBe(false)
			expect(mockCallbacks.onError).toHaveBeenCalledWith(
				'discovery.followFailed',
				{ name: 'Artist One' },
			)
		})

		it('should respawn bubble at original position on failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			await expect(
				sut.followArtist(makeArtist('a1', 'A'), { x: 100, y: 200 }),
			).rejects.toThrow()

			expect(mockCallbacks.respawnBubble).toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.objectContaining({ value: 'a1' }),
				}),
				{ x: 100, y: 200 },
			)
		})

		it('should remove artist from pool on follow', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))

			expect(
				pool.availableBubbles.find((a) => a.id?.value === 'a1'),
			).toBeUndefined()
		})
	})

	describe('followedIds derived getter', () => {
		it('should be an empty Set when followedArtists is empty', () => {
			expect(sut.followedIds.size).toBe(0)
		})

		it('should contain the artist ID after followArtist', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))

			expect(sut.followedIds.has('a1')).toBe(true)
		})

		it('should match followedArtists IDs', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))
			await sut.followArtist(makeArtist('a2', 'Artist Two'))

			const ids = [...sut.followedIds]
			expect(ids).toEqual(['a1', 'a2'])
		})
	})

	describe('atomicity — state and pool are synchronized', () => {
		it('should have artist in followedIds and absent from pool after follow', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))

			expect(sut.followedIds.has('a1')).toBe(true)
			expect(
				pool.availableBubbles.find((b) => b.id?.value === 'a1'),
			).toBeUndefined()
		})

		it('should have artist absent from followedIds and restored in pool after rollback', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('fail'),
			)

			await expect(
				sut.followArtist(makeArtist('a1', 'Artist One')),
			).rejects.toThrow()

			expect(sut.followedIds.has('a1')).toBe(false)
			expect(
				pool.availableBubbles.find((b) => b.id?.value === 'a1'),
			).toBeDefined()
		})
	})

	describe('regression: no dual-state desync', () => {
		it('should keep followedIds.size === 2 after sequential follow (3) then rollback (1)', async () => {
			await sut.followArtist(makeArtist('a1', 'Artist One'))
			await sut.followArtist(makeArtist('a2', 'Artist Two'))

			// Third follow will fail and rollback
			const a3 = makeArtist('a3', 'Artist Three')
			pool.add([a3])
			;(
				mockFollowClient.follow as ReturnType<typeof vi.fn>
			).mockRejectedValueOnce(new Error('fail'))

			await expect(sut.followArtist(a3)).rejects.toThrow()

			expect(sut.followedIds.size).toBe(2)
			expect(sut.followedIds.has('a1')).toBe(true)
			expect(sut.followedIds.has('a2')).toBe(true)
			expect(sut.followedIds.has('a3')).toBe(false)
			// Only the rolled-back artist is restored to pool
			expect(
				pool.availableBubbles.find((b) => b.id?.value === 'a3'),
			).toBeDefined()
		})
	})

	describe('checkLiveEvents', () => {
		it('should notify on upcoming events', async () => {
			;(
				mockConcertClient.listConcerts as ReturnType<typeof vi.fn>
			).mockResolvedValue([{ id: 'c1' }])

			sut.checkLiveEvents(makeArtist('a1', 'Live Band'))
			await vi.waitFor(() => {
				expect(mockCallbacks.onHasUpcomingEvents).toHaveBeenCalledWith(
					'Live Band',
				)
			})
		})

		it('should not notify when no events', async () => {
			;(
				mockConcertClient.listConcerts as ReturnType<typeof vi.fn>
			).mockResolvedValue([])

			sut.checkLiveEvents(makeArtist('a1', 'No Events'))
			await vi.waitFor(() => {
				expect(mockConcertClient.listConcerts).toHaveBeenCalled()
			})
			expect(mockCallbacks.onHasUpcomingEvents).not.toHaveBeenCalled()
		})
	})
})
