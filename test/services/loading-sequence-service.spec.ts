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

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js',
	() => ({
		SearchStatus: {
			UNSPECIFIED: 0,
			PENDING: 1,
			COMPLETED: 2,
			FAILED: 3,
		},
	}),
)

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

		it('should fire-and-forget searchNewConcerts and poll until all completed', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([
				{ id: 'a1', name: 'Artist 1' },
				{ id: 'a2', name: 'Artist 2' },
			])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			let pollCount = 0
			mockConcert.listSearchStatuses = vi.fn().mockImplementation(() => {
				pollCount++
				if (pollCount === 1) {
					// First poll: one pending, one completed
					return Promise.resolve([
						{ artistId: { value: 'a1' }, status: 2 },
						{ artistId: { value: 'a2' }, status: 1 },
					])
				}
				// Second poll: all completed
				return Promise.resolve([
					{ artistId: { value: 'a1' }, status: 2 },
					{ artistId: { value: 'a2' }, status: 2 },
				])
			})

			const promise = sut.aggregateData()

			// Advance past first poll (3s) + second poll (3s) + minimum display (3s)
			await vi.advanceTimersByTimeAsync(10_000)
			const result = await promise

			expect(result).toEqual({ status: 'success' })
			expect(mockConcert.searchNewConcerts).toHaveBeenCalledTimes(2)
			expect(mockConcert.listSearchStatuses).toHaveBeenCalledTimes(2)
		})

		it('should return partial when some searches fail', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([
				{ id: 'a1', name: 'Artist 1' },
				{ id: 'a2', name: 'Artist 2' },
				{ id: 'a3', name: 'Artist 3' },
			])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)
			mockConcert.listSearchStatuses = vi.fn().mockResolvedValue([
				{ artistId: { value: 'a1' }, status: 2 },
				{ artistId: { value: 'a2' }, status: 3 },
				{ artistId: { value: 'a3' }, status: 2 },
			])

			const promise = sut.aggregateData()
			await vi.advanceTimersByTimeAsync(10_000)
			const result = await promise

			expect(result).toEqual({
				status: 'partial',
				failedCount: 1,
				totalCount: 3,
			})
		})

		it('should update completedCount during polling', async () => {
			mockDiscovery.listFollowedFromBackend = vi.fn().mockResolvedValue([
				{ id: 'a1', name: 'Artist 1' },
				{ id: 'a2', name: 'Artist 2' },
			])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			let pollCount = 0
			mockConcert.listSearchStatuses = vi.fn().mockImplementation(() => {
				pollCount++
				if (pollCount === 1) {
					return Promise.resolve([
						{ artistId: { value: 'a1' }, status: 2 },
						{ artistId: { value: 'a2' }, status: 1 },
					])
				}
				return Promise.resolve([
					{ artistId: { value: 'a1' }, status: 2 },
					{ artistId: { value: 'a2' }, status: 2 },
				])
			})

			const promise = sut.aggregateData()

			// After first poll interval
			await vi.advanceTimersByTimeAsync(3100)
			expect(sut.completedCount).toBe(1)
			expect(sut.totalCount).toBe(2)

			// After second poll
			await vi.advanceTimersByTimeAsync(3100)
			expect(sut.completedCount).toBe(2)

			await vi.advanceTimersByTimeAsync(5000)
			await promise
		})

		it('should retry artist fetch on first failure', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockRejectedValueOnce(new Error('network error'))
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)
			mockConcert.listSearchStatuses = vi.fn().mockResolvedValue([
				{ artistId: { value: 'a1' }, status: 2 },
			])

			const promise = sut.aggregateData()
			await vi.advanceTimersByTimeAsync(10_000)
			const result = await promise

			expect(result.status).toBe('success')
			expect(mockDiscovery.listFollowedFromBackend).toHaveBeenCalledTimes(2)
		})

		it('should return failed when artist fetch fails after retry', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockRejectedValue(new Error('persistent error'))

			const promise = sut.aggregateData()
			await vi.advanceTimersByTimeAsync(1000)
			const result = await promise

			expect(result.status).toBe('failed')
			expect(mockDiscovery.listFollowedFromBackend).toHaveBeenCalledTimes(2)
		})

		it('should abort after global timeout (45s)', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)
			// Always return pending
			mockConcert.listSearchStatuses = vi.fn().mockResolvedValue([
				{ artistId: { value: 'a1' }, status: 1 },
			])

			const promise = sut.aggregateData()
			// Advance past 45s timeout
			await vi.advanceTimersByTimeAsync(46_000)
			const result = await promise

			// Timeout: proceed with available data (returns success, not error)
			expect(result.status).toBe('success')
		})

		it('should wait for minimum display duration', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)
			// Immediately completed on first poll
			mockConcert.listSearchStatuses = vi.fn().mockResolvedValue([
				{ artistId: { value: 'a1' }, status: 2 },
			])

			const promise = sut.aggregateData()

			// At 2999ms: should still be pending (first poll at 3s hasn't fired)
			await vi.advanceTimersByTimeAsync(2999)
			let resolved = false
			promise.then(() => {
				resolved = true
			})
			await Promise.resolve()
			expect(resolved).toBe(false)

			// Complete polling and minimum display
			await vi.advanceTimersByTimeAsync(2000)
			const result = await promise
			expect(result.status).toBe('success')
		})

		it('should handle poll errors gracefully and retry', async () => {
			mockDiscovery.listFollowedFromBackend = vi
				.fn()
				.mockResolvedValue([{ id: 'a1', name: 'Artist 1' }])
			mockConcert.searchNewConcerts = vi.fn().mockResolvedValue(undefined)

			let pollCount = 0
			mockConcert.listSearchStatuses = vi.fn().mockImplementation(() => {
				pollCount++
				if (pollCount === 1) {
					return Promise.reject(new Error('network error'))
				}
				return Promise.resolve([
					{ artistId: { value: 'a1' }, status: 2 },
				])
			})

			const promise = sut.aggregateData()
			// First poll fails at 3s, second poll succeeds at 6s
			await vi.advanceTimersByTimeAsync(10_000)
			const result = await promise

			expect(result.status).toBe('success')
			expect(mockConcert.listSearchStatuses).toHaveBeenCalledTimes(2)
		})
	})
})
