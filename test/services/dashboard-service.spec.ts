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

// Helpers to build mock Concert objects with the new VO proto structure.
// startEpoch: Unix epoch seconds as bigint for StartTime.value.seconds
function makeDate(year: number, month: number, day: number) {
	return { value: { year, month, day } }
}
function makeTimestamp(epochSeconds: number) {
	return { value: { seconds: BigInt(epochSeconds), nanos: 0 } }
}

describe('DashboardService', () => {
	let sut: DashboardService
	let mockArtistService: ReturnType<typeof createMockArtistServiceClient>
	let mockConcertService: ReturnType<typeof createMockConcertService>

	beforeEach(() => {
		localStorage.clear()

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
		mockArtistService.listFollowed = vi.fn().mockResolvedValue([])
		mockConcertService.listByFollower = vi.fn().mockResolvedValue([])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert
		expect(result).toEqual([])
	})

	it('should load and group concerts for multiple artists', async () => {
		// Arrange
		mockArtistService.listFollowed = vi.fn().mockResolvedValue([
			{ id: 'artist-1', name: 'Artist One', passionLevel: 0 },
			{ id: 'artist-2', name: 'Artist Two', passionLevel: 0 },
		])

		// Concerts have no adminArea — they land in 'other' lane (no userRegion set)
		const concert1: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 1' },
			localDate: makeDate(2026, 3, 15),
			startTime: makeTimestamp(1742054400), // 2026-03-15 19:00 UTC
			sourceUrl: { value: 'https://example.com/1' },
		}

		const concert2: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-2' },
			title: { value: 'Concert 2' },
			localDate: makeDate(2026, 3, 15),
			startTime: makeTimestamp(1742059800), // 2026-03-15 20:30 UTC
			sourceUrl: { value: 'https://example.com/2' },
		}

		const concert3: Partial<Concert> = {
			id: { value: 'concert-3' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 3' },
			localDate: makeDate(2026, 4, 10),
			startTime: makeTimestamp(1744221600), // 2026-04-10 18:00 UTC
			sourceUrl: { value: 'https://example.com/3' },
		}

		// listByFollower returns all concerts at once
		mockConcertService.listByFollower = vi
			.fn()
			.mockResolvedValue([concert1, concert2, concert3])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert
		expect(result).toHaveLength(2)

		// First date group (2026-03-15) — events go to 'other' (no adminArea, no userRegion)
		expect(result[0].dateKey).toBe('2026-03-15')
		expect(result[0].other).toHaveLength(2)
		expect(result[0].other[0].artistName).toBe('Artist One')
		expect(result[0].other[0].title).toBe('Concert 1')
		expect(result[0].other[1].artistName).toBe('Artist Two')
		expect(result[0].other[1].title).toBe('Concert 2')

		// Second date group (2026-04-10)
		expect(result[1].dateKey).toBe('2026-04-10')
		expect(result[1].other).toHaveLength(1)
		expect(result[1].other[0].artistName).toBe('Artist One')
		expect(result[1].other[0].title).toBe('Concert 3')
	})

	it('should handle listByFollower RPC failure gracefully', async () => {
		// Arrange
		mockArtistService.listFollowed = vi
			.fn()
			.mockResolvedValue([
				{ id: 'artist-1', name: 'Artist One', passionLevel: 0 },
			])

		mockConcertService.listByFollower = vi
			.fn()
			.mockRejectedValue(new Error('API error'))

		// Act & Assert - Promise.all rejects when listByFollower fails
		await expect(sut.loadDashboardEvents()).rejects.toThrow('API error')
	})

	it('should format concert times correctly', async () => {
		// Arrange
		mockArtistService.listFollowed = vi
			.fn()
			.mockResolvedValue([{ id: 'artist-1', name: 'Artist', passionLevel: 0 }])

		// 2026-05-01 09:05 UTC = seconds: 1746090300
		// 2026-05-01 08:30 UTC = seconds: 1746088200
		const concert: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert' },
			localDate: makeDate(2026, 5, 1),
			startTime: makeTimestamp(1746090300), // 09:05 UTC
			openTime: makeTimestamp(1746088200), // 08:30 UTC
			sourceUrl: { value: 'https://example.com' },
		}

		mockConcertService.listByFollower = vi.fn().mockResolvedValue([concert])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - time should match UTC hours/minutes from epoch
		const event = result[0].other[0]
		// Verify it's an HH:MM string (exact value depends on test runner timezone)
		expect(event.startTime).toMatch(/^\d{2}:\d{2}$/)
		expect(event.openTime).toMatch(/^\d{2}:\d{2}$/)
	})

	it('should skip concerts without localDate', async () => {
		// Arrange
		mockArtistService.listFollowed = vi
			.fn()
			.mockResolvedValue([{ id: 'artist-1', name: 'Artist', passionLevel: 0 }])

		const concertWithDate: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Good Concert' },
			localDate: makeDate(2026, 5, 1),
			sourceUrl: { value: 'https://example.com/1' },
		}

		const concertWithoutDate: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-1' },
			title: { value: 'Bad Concert' },
			localDate: undefined,
			sourceUrl: { value: 'https://example.com/2' },
		}

		mockConcertService.listByFollower = vi
			.fn()
			.mockResolvedValue([concertWithDate, concertWithoutDate])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - only concert with localDate should be included
		expect(result).toHaveLength(1)
		expect(result[0].other).toHaveLength(1)
		expect(result[0].other[0].title).toBe('Good Concert')
	})

	it('should sort events chronologically within load', async () => {
		// Arrange
		mockArtistService.listFollowed = vi
			.fn()
			.mockResolvedValue([{ id: 'artist-1', name: 'Artist', passionLevel: 0 }])

		// Return concerts in reverse chronological order
		const concert1: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Later Concert' },
			localDate: makeDate(2026, 6, 1),
			sourceUrl: { value: 'https://example.com/2' },
		}

		const concert2: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-1' },
			title: { value: 'Earlier Concert' },
			localDate: makeDate(2026, 5, 1),
			sourceUrl: { value: 'https://example.com/1' },
		}

		mockConcertService.listByFollower = vi
			.fn()
			.mockResolvedValue([concert1, concert2])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert - should be sorted chronologically
		expect(result[0].dateKey).toBe('2026-05-01')
		expect(result[1].dateKey).toBe('2026-06-01')
	})

	it('should assign events to main lane when adminArea matches user region', async () => {
		// Arrange — set user region in localStorage
		localStorage.setItem('user.adminArea', '東京')

		mockArtistService.listFollowed = vi
			.fn()
			.mockResolvedValue([{ id: 'artist-1', name: 'Artist', passionLevel: 0 }])

		const tokyoConcert: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Tokyo Concert' },
			localDate: makeDate(2026, 5, 1),
			venue: {
				name: { value: 'Zepp DiverCity' },
				adminArea: { value: '東京都' },
			},
			sourceUrl: { value: 'https://example.com/1' },
		}

		const osakaConcert: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-1' },
			title: { value: 'Osaka Concert' },
			localDate: makeDate(2026, 5, 1),
			venue: {
				name: { value: 'Zepp Namba' },
				adminArea: { value: '大阪府' },
			},
			sourceUrl: { value: 'https://example.com/2' },
		}

		const unknownConcert: Partial<Concert> = {
			id: { value: 'concert-3' },
			artistId: { value: 'artist-1' },
			title: { value: 'Unknown Concert' },
			localDate: makeDate(2026, 5, 1),
			sourceUrl: { value: 'https://example.com/3' },
		}

		mockConcertService.listByFollower = vi
			.fn()
			.mockResolvedValue([tokyoConcert, osakaConcert, unknownConcert])

		// Act
		const result = await sut.loadDashboardEvents()

		// Assert
		expect(result).toHaveLength(1)
		expect(result[0].main).toHaveLength(1)
		expect(result[0].main[0].title).toBe('Tokyo Concert')
		expect(result[0].region).toHaveLength(1)
		expect(result[0].region[0].title).toBe('Osaka Concert')
		expect(result[0].other).toHaveLength(1)
		expect(result[0].other[0].title).toBe('Unknown Concert')
	})
})
