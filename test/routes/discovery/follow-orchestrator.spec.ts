import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type FollowCallbacks,
	type FollowClient,
	type FollowConcertClient,
	FollowOrchestrator,
} from '../../../src/routes/discovery/follow-orchestrator'
import type { ArtistBubble } from '../../../src/services/artist-service-client'
import { BubblePool } from '../../../src/services/bubble-pool'
import { createMockLogger } from '../../../test/helpers/mock-logger'

function makeBubble(id: string, name: string): ArtistBubble {
	return { id, name, mbid: '', imageUrl: '', x: 0, y: 0, radius: 30 }
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
		pool.add([makeBubble('a1', 'Artist One'), makeBubble('a2', 'Artist Two')])
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
			await sut.followArtist(makeBubble('a1', 'Artist One'))

			expect(mockFollowClient.follow).toHaveBeenCalledWith('a1', 'Artist One')
			expect(sut.followedCount).toBe(1)
			expect(sut.followedIds.has('a1')).toBe(true)
			expect(mockCallbacks.onFollowed).toHaveBeenCalled()
		})

		it('should skip if artist already followed', async () => {
			await sut.followArtist(makeBubble('a1', 'Artist One'))
			await sut.followArtist(makeBubble('a1', 'Artist One'))

			expect(mockFollowClient.follow).toHaveBeenCalledTimes(1)
		})

		it('should rollback on failure', async () => {
			;(mockFollowClient.follow as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('network'),
			)

			await expect(
				sut.followArtist(makeBubble('a1', 'Artist One'), { x: 10, y: 20 }),
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
				sut.followArtist(makeBubble('a1', 'A'), { x: 100, y: 200 }),
			).rejects.toThrow()

			expect(mockCallbacks.respawnBubble).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'a1' }),
				{ x: 100, y: 200 },
			)
		})

		it('should remove artist from pool on follow', async () => {
			await sut.followArtist(makeBubble('a1', 'Artist One'))

			expect(pool.availableBubbles.find((b) => b.id === 'a1')).toBeUndefined()
		})
	})

	describe('checkLiveEvents', () => {
		it('should notify on upcoming events', async () => {
			;(
				mockConcertClient.listConcerts as ReturnType<typeof vi.fn>
			).mockResolvedValue([{ id: 'c1' }])

			sut.checkLiveEvents(makeBubble('a1', 'Live Band'))
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

			sut.checkLiveEvents(makeBubble('a1', 'No Events'))
			await vi.waitFor(() => {
				expect(mockConcertClient.listConcerts).toHaveBeenCalled()
			})
			expect(mockCallbacks.onHasUpcomingEvents).not.toHaveBeenCalled()
		})
	})
})
