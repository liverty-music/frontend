import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IConcertService } from '../../src/services/concert-service'
import {
	DashboardService,
	IDashboardService,
} from '../../src/services/dashboard-service'
import { isHypeMatched } from '../../src/entities/concert'
import { IFollowServiceClient } from '../../src/services/follow-service-client'
import { createTestContainer } from '../helpers/create-container'
import {
	createMockConcertService,
	createMockFollowServiceClient,
} from '../helpers/mock-rpc-clients'

// Helpers to build mock proto-like objects
function makeDate(year: number, month: number, day: number) {
	return { value: { year, month, day } }
}
function makeTimestamp(epochSeconds: number) {
	return { value: { seconds: BigInt(epochSeconds), nanos: 0 } }
}

/** Build a DateLaneGroup-shaped object matching the proto structure. */
function makeDateLaneGroup(
	date: ReturnType<typeof makeDate>,
	lanes: {
		home?: Partial<Concert>[]
		nearby?: Partial<Concert>[]
		away?: Partial<Concert>[]
	},
) {
	return {
		date,
		home: lanes.home ?? [],
		nearby: lanes.nearby ?? [],
		away: lanes.away ?? [],
	}
}

describe('isHypeMatched', () => {
	it.each([
		// watch never matches
		{ hype: 'watch' as const, lane: 'home' as const, expected: false },
		{ hype: 'watch' as const, lane: 'nearby' as const, expected: false },
		{ hype: 'watch' as const, lane: 'away' as const, expected: false },
		// home matches home only
		{ hype: 'home' as const, lane: 'home' as const, expected: true },
		{ hype: 'home' as const, lane: 'nearby' as const, expected: false },
		{ hype: 'home' as const, lane: 'away' as const, expected: false },
		// nearby matches home and nearby
		{ hype: 'nearby' as const, lane: 'home' as const, expected: true },
		{ hype: 'nearby' as const, lane: 'nearby' as const, expected: true },
		{ hype: 'nearby' as const, lane: 'away' as const, expected: false },
		// away matches all
		{ hype: 'away' as const, lane: 'home' as const, expected: true },
		{ hype: 'away' as const, lane: 'nearby' as const, expected: true },
		{ hype: 'away' as const, lane: 'away' as const, expected: true },
	])('hype=$hype lane=$lane → $expected', ({ hype, lane, expected }) => {
		expect(isHypeMatched(hype, lane)).toBe(expected)
	})
})

describe('DashboardService', () => {
	let sut: DashboardService
	let container: ReturnType<typeof createTestContainer>
	let mockFollowService: ReturnType<typeof createMockFollowServiceClient>
	let mockConcertService: ReturnType<typeof createMockConcertService>

	beforeEach(() => {
		mockFollowService = createMockFollowServiceClient()
		mockConcertService = createMockConcertService()

		container = createTestContainer(
			Registration.instance(IFollowServiceClient, mockFollowService),
			Registration.instance(IConcertService, mockConcertService),
		)
		container.register(DashboardService)
		sut = container.get(IDashboardService)
	})

	it('should return empty array when no groups returned', async () => {
		mockFollowService.listFollowed = vi.fn().mockResolvedValue([])
		mockConcertService.listByFollower = vi.fn().mockResolvedValue([])

		const result = await sut.loadDashboardEvents()

		expect(result).toEqual([])
	})

	it('should map server-provided DateLaneGroup to frontend DateGroup', async () => {
		mockFollowService.listFollowed = vi.fn().mockResolvedValue([
			{
				artist: { id: 'artist-1', name: 'Artist One', mbid: '' },
				hype: 'watch',
			},
			{
				artist: { id: 'artist-2', name: 'Artist Two', mbid: '' },
				hype: 'watch',
			},
		])

		const concert1: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 1' },
			localDate: makeDate(2026, 3, 15),
			startTime: makeTimestamp(1742054400),
			sourceUrl: { value: 'https://example.com/1' },
		}

		const concert2: Partial<Concert> = {
			id: { value: 'concert-2' },
			artistId: { value: 'artist-2' },
			title: { value: 'Concert 2' },
			localDate: makeDate(2026, 3, 15),
			startTime: makeTimestamp(1742059800),
			sourceUrl: { value: 'https://example.com/2' },
		}

		const concert3: Partial<Concert> = {
			id: { value: 'concert-3' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert 3' },
			localDate: makeDate(2026, 4, 10),
			startTime: makeTimestamp(1744221600),
			sourceUrl: { value: 'https://example.com/3' },
		}

		// Server returns grouped by date with all concerts in 'away' lane
		mockConcertService.listByFollower = vi.fn().mockResolvedValue([
			makeDateLaneGroup(makeDate(2026, 3, 15), {
				away: [concert1, concert2],
			}),
			makeDateLaneGroup(makeDate(2026, 4, 10), {
				away: [concert3],
			}),
		])

		const result = await sut.loadDashboardEvents()

		expect(result).toHaveLength(2)

		expect(result[0].dateKey).toBe('2026-03-15')
		expect(result[0].away).toHaveLength(2)
		expect(result[0].away[0].artistName).toBe('Artist One')
		expect(result[0].away[0].title).toBe('Concert 1')
		expect(result[0].away[1].artistName).toBe('Artist Two')
		expect(result[0].away[1].title).toBe('Concert 2')

		expect(result[1].dateKey).toBe('2026-04-10')
		expect(result[1].away).toHaveLength(1)
		expect(result[1].away[0].artistName).toBe('Artist One')
		expect(result[1].away[0].title).toBe('Concert 3')
	})

	it('should handle listByFollower RPC failure gracefully', async () => {
		mockFollowService.listFollowed = vi.fn().mockResolvedValue([
			{
				artist: { id: 'artist-1', name: 'Artist One', mbid: '' },
				hype: 'watch',
			},
		])

		mockConcertService.listByFollower = vi
			.fn()
			.mockRejectedValue(new Error('API error'))

		await expect(sut.loadDashboardEvents()).rejects.toThrow('API error')
	})

	it('should format concert times correctly', async () => {
		mockFollowService.listFollowed = vi.fn().mockResolvedValue([
			{
				artist: { id: 'artist-1', name: 'Artist', mbid: '' },
				hype: 'watch',
			},
		])

		const concert: Partial<Concert> = {
			id: { value: 'concert-1' },
			artistId: { value: 'artist-1' },
			title: { value: 'Concert' },
			localDate: makeDate(2026, 5, 1),
			startTime: makeTimestamp(1746090300), // 09:05 UTC
			openTime: makeTimestamp(1746088200), // 08:30 UTC
			sourceUrl: { value: 'https://example.com' },
		}

		mockConcertService.listByFollower = vi
			.fn()
			.mockResolvedValue([
				makeDateLaneGroup(makeDate(2026, 5, 1), { away: [concert] }),
			])

		const result = await sut.loadDashboardEvents()

		const event = result[0].away[0]
		expect(event.startTime).toMatch(/^\d{2}:\d{2}$/)
		expect(event.openTime).toMatch(/^\d{2}:\d{2}$/)
	})

	it('should skip concerts without localDate', async () => {
		mockFollowService.listFollowed = vi.fn().mockResolvedValue([
			{
				artist: { id: 'artist-1', name: 'Artist', mbid: '' },
				hype: 'watch',
			},
		])

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

		// Server includes a concert without date in away lane
		mockConcertService.listByFollower = vi.fn().mockResolvedValue([
			makeDateLaneGroup(makeDate(2026, 5, 1), {
				away: [concertWithDate, concertWithoutDate],
			}),
		])

		const result = await sut.loadDashboardEvents()

		expect(result).toHaveLength(1)
		expect(result[0].away).toHaveLength(1)
		expect(result[0].away[0].title).toBe('Good Concert')
	})

	it('should map concerts in all three lanes correctly', async () => {
		mockFollowService.listFollowed = vi.fn().mockResolvedValue([
			{
				artist: { id: 'artist-1', name: 'Artist One', mbid: '' },
				hype: 'watch',
			},
		])

		const homeConcert: Partial<Concert> = {
			id: { value: 'concert-home' },
			artistId: { value: 'artist-1' },
			title: { value: 'Tokyo Concert' },
			localDate: makeDate(2026, 5, 1),
			venue: {
				name: { value: 'Zepp DiverCity' },
				adminArea: { value: 'JP-13' },
			},
			sourceUrl: { value: 'https://example.com/1' },
		}

		const nearbyConcert: Partial<Concert> = {
			id: { value: 'concert-nearby' },
			artistId: { value: 'artist-1' },
			title: { value: 'Saitama Concert' },
			localDate: makeDate(2026, 5, 1),
			venue: {
				name: { value: 'Saitama Super Arena' },
				adminArea: { value: 'JP-11' },
			},
			sourceUrl: { value: 'https://example.com/2' },
		}

		const awayConcert: Partial<Concert> = {
			id: { value: 'concert-away' },
			artistId: { value: 'artist-1' },
			title: { value: 'Osaka Concert' },
			localDate: makeDate(2026, 5, 1),
			venue: {
				name: { value: 'Zepp Namba' },
				adminArea: { value: 'JP-27' },
			},
			sourceUrl: { value: 'https://example.com/3' },
		}

		// Server provides lane classification
		mockConcertService.listByFollower = vi.fn().mockResolvedValue([
			makeDateLaneGroup(makeDate(2026, 5, 1), {
				home: [homeConcert],
				nearby: [nearbyConcert],
				away: [awayConcert],
			}),
		])

		const result = await sut.loadDashboardEvents()

		expect(result).toHaveLength(1)
		expect(result[0].home).toHaveLength(1)
		expect(result[0].home[0].title).toBe('Tokyo Concert')
		expect(result[0].nearby).toHaveLength(1)
		expect(result[0].nearby[0].title).toBe('Saitama Concert')
		expect(result[0].away).toHaveLength(1)
		expect(result[0].away[0].title).toBe('Osaka Concert')
	})
})
