import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IArtistServiceClient } from '../../src/services/artist-service-client'
import { IConcertService } from '../../src/services/concert-service'
import {
	DashboardService,
	IDashboardService,
} from '../../src/services/dashboard-service'
import { createTestContainer } from '../helpers/create-container'
import {
	createMockArtistServiceClient,
	createMockConcertService,
} from '../helpers/mock-rpc-clients'

describe('DashboardService', () => {
	let sut: DashboardService
	let mockArtistService: ReturnType<typeof createMockArtistServiceClient>
	let mockConcertService: ReturnType<typeof createMockConcertService>

	beforeEach(() => {
		mockArtistService = createMockArtistServiceClient()
		mockConcertService = createMockConcertService()

		const container = createTestContainer(
			Registration.instance(IArtistServiceClient, mockArtistService),
			Registration.instance(IConcertService, mockConcertService),
		)
		container.register(DashboardService)
		sut = container.get(IDashboardService)
	})

	it('should return empty array when no followed artists', async () => {
		// Arrange
		mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
			artists: [],
		})

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert
		expect(result).toEqual([])
		expect(mockConcertService.listConcerts).not.toHaveBeenCalled()
	})

	it('should load and group concerts for multiple artists', async () => {
		// Arrange
		const artist1 = { id: { value: 'artist-1' }, name: { value: 'Artist One' } }
		const artist2 = { id: { value: 'artist-2' }, name: { value: 'Artist Two' } }

		mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
			artists: [artist1, artist2],
		})

		const concert1: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 1' },
			date: { year: 2026, month: 3, day: 15 },
			startTime: { hours: 19, minutes: 0 },
			sourceUrl: 'https://example.com/1',
		}

		const concert2: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-2' },
			title: { value: 'Concert 2' },
			date: { year: 2026, month: 3, day: 15 },
			startTime: { hours: 20, minutes: 30 },
			sourceUrl: 'https://example.com/2',
		}

		const concert3: Partial<Concert> = {
			id: { value: 'concert-3' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 3' },
			date: { year: 2026, month: 4, day: 10 },
			startTime: { hours: 18, minutes: 0 },
			sourceUrl: 'https://example.com/3',
		}

		mockConcertService.listConcerts = vi
			.fn()
			.mockImplementation((artistId: string) => {
				if (artistId === 'artist-1') {
					return Promise.resolve([concert1, concert3])
				}
				if (artistId === 'artist-2') {
					return Promise.resolve([concert2])
				}
				return Promise.resolve([])
			})

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert
		expect(result).toHaveLength(2)

		// First date group (2026-03-15)
		expect(result[0].dateKey).toBe('2026-03-15')
		expect(result[0].main).toHaveLength(2)
		expect(result[0].main[0].artistName).toBe('Artist One')
		expect(result[0].main[0].title).toBe('Concert 1')
		expect(result[0].main[0].startTime).toBe('19:00')
		expect(result[0].main[1].artistName).toBe('Artist Two')
		expect(result[0].main[1].title).toBe('Concert 2')

		// Second date group (2026-04-10)
		expect(result[1].dateKey).toBe('2026-04-10')
		expect(result[1].main).toHaveLength(1)
		expect(result[1].main[0].artistName).toBe('Artist One')
		expect(result[1].main[0].title).toBe('Concert 3')
	})

	it('should handle partial RPC failure using Promise.allSettled', async () => {
		// Arrange
		const artist1 = { id: { value: 'artist-1' }, name: { value: 'Artist One' } }
		const artist2 = { id: { value: 'artist-2' }, name: { value: 'Artist Two' } }

		mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
			artists: [artist1, artist2],
		})

		const concert1: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 1' },
			date: { year: 2026, month: 3, day: 15 },
			sourceUrl: 'https://example.com/1',
		}

		mockConcertService.listConcerts = vi
			.fn()
			.mockImplementation((artistId: string) => {
				if (artistId === 'artist-1') {
					return Promise.resolve([concert1])
				}
				// Simulate failure for artist-2
				return Promise.reject(new Error('API error'))
			})

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - should still return events from successful artist
		expect(result).toHaveLength(1)
		expect(result[0].main).toHaveLength(1)
		expect(result[0].main[0].artistName).toBe('Artist One')
	})

	it('should format concert times correctly', async () => {
		// Arrange
		const artist = { id: { value: 'artist-1' }, name: { value: 'Artist' } }
		mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
			artists: [artist],
		})

		const concert: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert' },
			date: { year: 2026, month: 5, day: 1 },
			startTime: { hours: 9, minutes: 5 },
			openTime: { hours: 8, minutes: 30 },
			sourceUrl: 'https://example.com',
		}

		mockConcertService.listConcerts = vi.fn().mockResolvedValue([concert])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - time should be padded
		expect(result[0].main[0].startTime).toBe('09:05')
		expect(result[0].main[0].openTime).toBe('08:30')
	})

	it('should skip concerts without dates', async () => {
		// Arrange
		const artist = { id: { value: 'artist-1' }, name: { value: 'Artist' } }
		mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
			artists: [artist],
		})

		const concertWithDate: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Good Concert' },
			date: { year: 2026, month: 5, day: 1 },
			sourceUrl: 'https://example.com/1',
		}

		const concertWithoutDate: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-1' },
			title: { value: 'Bad Concert' },
			date: undefined,
			sourceUrl: 'https://example.com/2',
		}

		mockConcertService.listConcerts = vi
			.fn()
			.mockResolvedValue([concertWithDate, concertWithoutDate])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - only concert with date should be included
		expect(result).toHaveLength(1)
		expect(result[0].main).toHaveLength(1)
		expect(result[0].main[0].title).toBe('Good Concert')
	})

	it('should sort events chronologically within load', async () => {
		// Arrange
		const artist = { id: { value: 'artist-1' }, name: { value: 'Artist' } }
		mockArtistService.getClient!().listFollowed = vi.fn().mockResolvedValue({
			artists: [artist],
		})

		// Return concerts in reverse chronological order
		const concert1: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Later Concert' },
			date: { year: 2026, month: 6, day: 1 },
			sourceUrl: 'https://example.com/2',
		}

		const concert2: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-1' },
			title: { value: 'Earlier Concert' },
			date: { year: 2026, month: 5, day: 1 },
			sourceUrl: 'https://example.com/1',
		}

		mockConcertService.listConcerts = vi
			.fn()
			.mockResolvedValue([concert1, concert2])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - should be sorted chronologically
		expect(result[0].dateKey).toBe('2026-05-01')
		expect(result[1].dateKey).toBe('2026-06-01')
	})
})
