import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type ConcertSearchCallbacks,
	type ConcertSearchClient,
	ConcertSearchTracker,
} from '../../../src/routes/discovery/concert-search-tracker'
import { createMockLogger } from '../../../test/helpers/mock-logger'

describe('ConcertSearchTracker', () => {
	let sut: ConcertSearchTracker
	let mockClient: ConcertSearchClient
	let mockCallbacks: ConcertSearchCallbacks
	let abortController: AbortController
	let followedCount: number

	beforeEach(() => {
		vi.useFakeTimers()

		mockClient = {
			searchNewConcerts: vi.fn().mockResolvedValue(undefined),
			listByFollower: vi.fn().mockResolvedValue([{ id: 'g1' }]),
		}

		mockCallbacks = {
			onAllSearchesComplete: vi.fn(),
		}

		abortController = new AbortController()
		followedCount = 0

		sut = new ConcertSearchTracker(
			mockClient,
			mockCallbacks,
			createMockLogger(),
			() => abortController.signal,
			() => followedCount,
			3,
		)
	})

	afterEach(() => {
		sut.dispose()
		vi.useRealTimers()
	})

	describe('searchConcertsWithTimeout', () => {
		it('should call searchNewConcerts for the artist', async () => {
			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			expect(mockClient.searchNewConcerts).toHaveBeenCalledWith('a1')
		})

		it('should not duplicate search for same artist', () => {
			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a1')

			expect(mockClient.searchNewConcerts).toHaveBeenCalledTimes(1)
		})

		it('should mark as done on success', async () => {
			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.completedSearchCount).toBe(1)
		})

		it('should mark as done on failure', async () => {
			;(
				mockClient.searchNewConcerts as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('network'))

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.completedSearchCount).toBe(1)
		})

		it('should mark as done on timeout', async () => {
			;(
				mockClient.searchNewConcerts as ReturnType<typeof vi.fn>
			).mockReturnValue(new Promise(() => {})) // never resolves

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(15_000)

			expect(sut.completedSearchCount).toBe(1)
		})
	})

	describe('allSearchesComplete', () => {
		it('should be false when followed count is below target', () => {
			followedCount = 2
			expect(sut.allSearchesComplete).toBe(false)
		})

		it('should be false when not all searches are done', () => {
			followedCount = 3
			sut.searchConcertsWithTimeout('a1')
			// Only 1 search started, need 3
			expect(sut.allSearchesComplete).toBe(false)
		})

		it('should be true when all searches complete and followed >= target', async () => {
			followedCount = 3
			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')

			await vi.advanceTimersByTimeAsync(0)

			expect(sut.allSearchesComplete).toBe(true)
		})
	})

	describe('showDashboardCoachMark', () => {
		it('should be false when concertGroupCount is 0', async () => {
			followedCount = 3
			;(
				mockClient.listByFollower as ReturnType<typeof vi.fn>
			).mockResolvedValue([])

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('should be true when all searches complete and concerts exist', async () => {
			followedCount = 3
			;(
				mockClient.listByFollower as ReturnType<typeof vi.fn>
			).mockResolvedValue([{ id: 'g1' }])

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.showDashboardCoachMark).toBe(true)
		})
	})

	describe('syncPreSeeded', () => {
		it('should start searches for pre-seeded artists', () => {
			sut.syncPreSeeded([{ artistId: 'a1' }, { artistId: 'a2' }])

			expect(mockClient.searchNewConcerts).toHaveBeenCalledTimes(2)
		})

		it('should skip already-tracked artists', () => {
			sut.searchConcertsWithTimeout('a1')
			sut.syncPreSeeded([{ artistId: 'a1' }, { artistId: 'a2' }])

			expect(mockClient.searchNewConcerts).toHaveBeenCalledTimes(2)
		})
	})

	describe('dispose', () => {
		it('should clear pending timeouts', async () => {
			;(
				mockClient.searchNewConcerts as ReturnType<typeof vi.fn>
			).mockReturnValue(new Promise(() => {}))

			sut.searchConcertsWithTimeout('a1')
			sut.dispose()

			await vi.advanceTimersByTimeAsync(15_000)
			// Should not throw or increment — timeout was cleared
			expect(sut.completedSearchCount).toBe(0)
		})
	})
})
