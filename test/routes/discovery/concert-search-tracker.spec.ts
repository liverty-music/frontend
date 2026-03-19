import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	type ConcertSearchCallbacks,
	type ConcertSearchClient,
	ConcertSearchTracker,
	type SearchStatusResult,
} from '../../../src/routes/discovery/concert-search-tracker'
import { createMockLogger } from '../../../test/helpers/mock-logger'

function statusResult(
	artistId: string,
	status: SearchStatusResult['status'],
): SearchStatusResult {
	return { artistId, status }
}

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
			listSearchStatuses: vi
				.fn()
				.mockResolvedValue([]) as ConcertSearchClient['listSearchStatuses'],
			verifyConcertsExist: vi.fn().mockResolvedValue(true),
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
		it('should fire searchNewConcerts RPC for the artist', async () => {
			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			expect(mockClient.searchNewConcerts).toHaveBeenCalledWith('a1')
		})

		it('should not duplicate search for same artist', () => {
			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a1')

			expect(mockClient.searchNewConcerts).toHaveBeenCalledTimes(1)
		})

		it('should NOT mark as done on RPC return (fire-and-forget)', async () => {
			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			// RPC resolved but search is NOT done — must wait for polling
			expect(sut.completedSearchCount).toBe(0)
		})

		it('should NOT mark as done on RPC failure (fire-and-forget)', async () => {
			;(
				mockClient.searchNewConcerts as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('network'))

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			expect(sut.completedSearchCount).toBe(0)
		})
	})

	describe('polling via listSearchStatuses', () => {
		it('should mark artist done when poll returns COMPLETED', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([statusResult('a1', 'completed')])

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			// First poll at 2s
			await vi.advanceTimersByTimeAsync(2_000)

			expect(sut.completedSearchCount).toBe(1)
		})

		it('should mark artist done when poll returns FAILED', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([statusResult('a1', 'failed')])

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(2_000)

			expect(sut.completedSearchCount).toBe(1)
		})

		it('should keep artist pending when poll returns PENDING', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([statusResult('a1', 'pending')])

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(2_000)

			expect(sut.completedSearchCount).toBe(0)
		})

		it('should batch all pending artist IDs into a single poll call', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([
				statusResult('a1', 'pending'),
				statusResult('a2', 'pending'),
				statusResult('a3', 'pending'),
			])

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)

			// First poll
			await vi.advanceTimersByTimeAsync(2_000)

			expect(mockClient.listSearchStatuses).toHaveBeenCalledTimes(1)
			expect(mockClient.listSearchStatuses).toHaveBeenCalledWith(
				expect.arrayContaining(['a1', 'a2', 'a3']),
				expect.anything(),
			)
		})

		it('should call verifyConcertsExist after all searches complete via polling', async () => {
			followedCount = 3
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([
				statusResult('a1', 'completed'),
				statusResult('a2', 'completed'),
				statusResult('a3', 'completed'),
			])

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)

			// Poll completes all
			await vi.advanceTimersByTimeAsync(2_000)

			expect(mockClient.verifyConcertsExist).toHaveBeenCalledTimes(1)
			expect(mockClient.verifyConcertsExist).toHaveBeenCalledWith(
				expect.arrayContaining(['a1', 'a2', 'a3']),
				expect.anything(),
			)
		})

		it('should NOT call verifyConcertsExist before allSearchesComplete', async () => {
			followedCount = 3
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([statusResult('a1', 'completed')])

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(2_000)

			// Only 1 of 3 done
			expect(mockClient.verifyConcertsExist).not.toHaveBeenCalled()
		})
	})

	describe('per-artist timeout', () => {
		it('should mark artist done after 15s even if poll returns PENDING', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([statusResult('a1', 'pending')])

			followedCount = 1

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			// Advance through multiple poll cycles, all returning PENDING
			await vi.advanceTimersByTimeAsync(14_000)
			expect(sut.completedSearchCount).toBe(0)

			// At 15s+ the timeout kicks in
			await vi.advanceTimersByTimeAsync(2_000)
			expect(sut.completedSearchCount).toBe(1)
		})
	})

	describe('polling error resilience', () => {
		it('should retry on next poll cycle when listSearchStatuses throws', async () => {
			const listSearchStatuses = mockClient.listSearchStatuses as ReturnType<
				typeof vi.fn
			>
			listSearchStatuses.mockRejectedValueOnce(new Error('network error'))
			listSearchStatuses.mockResolvedValueOnce([
				statusResult('a1', 'completed'),
			])

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			// First poll fails
			await vi.advanceTimersByTimeAsync(2_000)
			expect(sut.completedSearchCount).toBe(0)

			// Second poll succeeds
			await vi.advanceTimersByTimeAsync(2_000)
			expect(sut.completedSearchCount).toBe(1)
		})

		it('should still timeout even if polls keep failing', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockRejectedValue(new Error('persistent error'))

			followedCount = 1

			sut.searchConcertsWithTimeout('a1')
			await vi.advanceTimersByTimeAsync(0)

			// After 15s, timeout overrides poll failures
			await vi.advanceTimersByTimeAsync(16_000)
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
			expect(sut.allSearchesComplete).toBe(false)
		})

		it('should be true when all searches complete via polling and followed >= target', async () => {
			followedCount = 3
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([
				statusResult('a1', 'completed'),
				statusResult('a2', 'completed'),
				statusResult('a3', 'completed'),
			])

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(2_000)

			expect(sut.allSearchesComplete).toBe(true)
		})
	})

	describe('showDashboardCoachMark', () => {
		it('should be false when no concerts exist', async () => {
			followedCount = 3
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([
				statusResult('a1', 'completed'),
				statusResult('a2', 'completed'),
				statusResult('a3', 'completed'),
			])
			;(
				mockClient.verifyConcertsExist as ReturnType<typeof vi.fn>
			).mockResolvedValue(false)

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(2_000)

			expect(sut.showDashboardCoachMark).toBe(false)
		})

		it('should be true when all searches complete and concerts exist', async () => {
			followedCount = 3
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([
				statusResult('a1', 'completed'),
				statusResult('a2', 'completed'),
				statusResult('a3', 'completed'),
			])
			;(
				mockClient.verifyConcertsExist as ReturnType<typeof vi.fn>
			).mockResolvedValue(true)

			sut.searchConcertsWithTimeout('a1')
			sut.searchConcertsWithTimeout('a2')
			sut.searchConcertsWithTimeout('a3')
			await vi.advanceTimersByTimeAsync(0)
			await vi.advanceTimersByTimeAsync(2_000)

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
		it('should clear polling interval', async () => {
			;(
				mockClient.listSearchStatuses as ReturnType<typeof vi.fn>
			).mockResolvedValue([statusResult('a1', 'pending')])

			sut.searchConcertsWithTimeout('a1')
			sut.dispose()

			await vi.advanceTimersByTimeAsync(16_000)
			// Polling was cleared, so listSearchStatuses should not have been called
			expect(mockClient.listSearchStatuses).not.toHaveBeenCalled()
		})
	})
})
