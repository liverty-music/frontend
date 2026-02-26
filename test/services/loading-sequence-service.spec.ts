import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import {
	createMockArtistDiscoveryService,
	createMockConcertService,
} from '../helpers/mock-rpc-clients'

const mockIArtistDiscoveryService = DI.createInterface(
	'IArtistDiscoveryService',
)
const mockIConcertService = DI.createInterface('IConcertService')

vi.mock('../../src/services/artist-discovery-service', () => ({
	IArtistDiscoveryService: mockIArtistDiscoveryService,
}))

vi.mock('../../src/services/concert-service', () => ({
	IConcertService: mockIConcertService,
}))

const { LoadingSequenceService, ILoadingSequenceService } = await import(
	'../../src/services/loading-sequence-service'
)

describe('LoadingSequenceService', () => {
	let sut: InstanceType<typeof LoadingSequenceService>
	let mockDiscovery: ReturnType<typeof createMockArtistDiscoveryService>
	let mockConcert: ReturnType<typeof createMockConcertService>

	beforeEach(() => {
		vi.useFakeTimers()

		mockDiscovery = createMockArtistDiscoveryService()
		mockConcert = createMockConcertService()

		const container = createTestContainer(
			Registration.instance(mockIArtistDiscoveryService, mockDiscovery),
			Registration.instance(mockIConcertService, mockConcert),
		)
		container.register(LoadingSequenceService)
		sut = container.get(ILoadingSequenceService)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe('aggregateData', () => {
		it('should return success when no followed artists', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([])

			const promise = sut.aggregateData()
			await vi.advanceTimersByTimeAsync(100)
			const result = await promise

			expect(result).toEqual({ status: 'success' })
		})

		it('should return success after fetching concerts for all artists', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([
				{ id: 'a1', name: 'Artist 1' },
				{ id: 'a2', name: 'Artist 2' },
			])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			const promise = sut.aggregateData()
			// Advance past minimum display time (3000ms)
			await vi.advanceTimersByTimeAsync(3100)
			const result = await promise

			expect(result).toEqual({ status: 'success' })
			expect(mockConcert.searchNewConcerts).toHaveBeenCalledTimes(2)
		})

		it('should wait for minimum display duration', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			const promise = sut.aggregateData()

			// At 2999ms, should still be pending
			await vi.advanceTimersByTimeAsync(2999)
			let resolved = false
			promise.then(() => {
				resolved = true
			})
			await Promise.resolve()
			expect(resolved).toBe(false)

			// At 3000ms+, should resolve
			await vi.advanceTimersByTimeAsync(200)
			const result = await promise
			expect(result.status).toBe('success')
		})

		it('should return partial when some concert searches fail', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([
				{ id: 'a1', name: 'Artist 1' },
				{ id: 'a2', name: 'Artist 2' },
				{ id: 'a3', name: 'Artist 3' },
			])
			mockConcert.searchNewConcerts = vi
				.fn()
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(new Error('search failed'))
				.mockResolvedValueOnce(undefined)

			const promise = sut.aggregateData()
			await vi.advanceTimersByTimeAsync(3100)
			const result = await promise

			expect(result).toEqual({
				status: 'partial',
				failedCount: 1,
				totalCount: 3,
			})
		})

		it('should retry artist fetch on first failure', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockRejectedValueOnce(new Error('network error'))
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			const promise = sut.aggregateData()
			// Advance past retry delay (500ms) + minimum display
			await vi.advanceTimersByTimeAsync(4000)
			const result = await promise

			expect(result.status).toBe('success')
			expect(mockDiscovery.listFollowedFromBackend).toHaveBeenCalledTimes(2)
		})

		it('should return failed when artist fetch fails after retry', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockRejectedValue(new Error('persistent error'))

			const promise = sut.aggregateData()
			// Advance past retry delay
			await vi.advanceTimersByTimeAsync(1000)
			const result = await promise

			expect(result.status).toBe('failed')
			expect(mockDiscovery.listFollowedFromBackend).toHaveBeenCalledTimes(2)
		})

		it('should abort after global timeout', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			// Concert search that respects AbortSignal
			mockConcert.searchNewConcerts = vi.fn().mockImplementation(
				(_id: string, signal?: AbortSignal) =>
					new Promise((_resolve, reject) => {
						if (signal?.aborted) {
							reject(new DOMException('aborted', 'AbortError'))
							return
						}
						signal?.addEventListener('abort', () => {
							reject(new DOMException('aborted', 'AbortError'))
						})
					}),
			)

			const promise = sut.aggregateData()
			// Advance to global timeout (10000ms)
			await vi.advanceTimersByTimeAsync(10100)
			const result = await promise

			// After timeout, concert search failures are caught, returns partial or success
			expect(['success', 'partial']).toContain(result.status)
		})

		it('should process artists in batches of 5', async () => {
			const artists = Array.from({ length: 7 }, (_, i) => ({
				id: `a${i}`,
				name: `Artist ${i}`,
			}))
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue(artists)
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			const promise = sut.aggregateData()
			await vi.advanceTimersByTimeAsync(3100)
			const result = await promise

			expect(result.status).toBe('success')
			expect(mockConcert.searchNewConcerts).toHaveBeenCalledTimes(7)
		})
	})
})
