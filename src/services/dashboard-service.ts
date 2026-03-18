import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { ProximityGroup } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import { displayName } from '../constants/iso3166'
import type {
	Concert,
	DateGroup,
	HypeLevel,
	JourneyStatus,
	LaneType,
} from '../entities/concert'
import type { Hype } from '../entities/follow'
import { IConcertService } from './concert-service'
import { IFollowServiceClient } from './follow-service-client'
import { ITicketJourneyService } from './ticket-journey-service'

export const IDashboardService = DI.createInterface<IDashboardService>(
	'IDashboardService',
	(x) => x.singleton(DashboardService),
)

export interface IDashboardService extends DashboardService {}

export class DashboardService {
	private readonly logger = resolve(ILogger).scopeTo('DashboardService')
	private readonly concertService = resolve(IConcertService)
	private readonly followService = resolve(IFollowServiceClient)
	private readonly journeyService = resolve(ITicketJourneyService)

	public async loadDashboardEvents(signal?: AbortSignal): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')

		const [artistMap, groups, journeyMap] = await Promise.all([
			this.fetchFollowedArtistMap(signal),
			this.concertService.listByFollower(signal),
			this.fetchJourneyMap(signal),
		])

		if (groups.length === 0) {
			this.logger.info('No concert groups returned')
			return []
		}

		return groups.map((g) =>
			this.protoGroupToDateGroup(g, artistMap, journeyMap),
		)
	}

	private protoGroupToDateGroup(
		group: ProximityGroup,
		artistMap: Map<string, { artist: Artist; hype: Hype }>,
		journeyMap: Map<string, JourneyStatus>,
	): DateGroup {
		const ld = group.date?.value
		const jsDate = ld ? new Date(ld.year, ld.month - 1, ld.day) : new Date()

		const dateKey = ld
			? `${ld.year}-${String(ld.month).padStart(2, '0')}-${String(ld.day).padStart(2, '0')}`
			: ''

		const label = jsDate.toLocaleDateString('ja-JP', {
			month: 'long',
			day: 'numeric',
			weekday: 'short',
		})

		const convert = (concerts: ProtoConcert[], lane: LaneType) =>
			concerts.flatMap((c) => {
				const artistId = c.artistId?.value ?? ''
				const entry = artistMap.get(artistId)
				const hypeLevel: HypeLevel = entry?.hype ?? 'watch'
				const event = protoConcertToEntity(
					c,
					entry?.artist.name?.value ?? '',
					hypeLevel,
					isHypeMatched(hypeLevel, lane),
					entry?.artist,
				)
				if (!event) return []
				const eventId = c.id?.value
				if (eventId) {
					event.journeyStatus = journeyMap.get(eventId)
				}
				return [event]
			})

		return {
			label,
			dateKey,
			home: convert(group.home, 'home'),
			nearby: convert(group.nearby, 'nearby'),
			away: convert(group.away, 'away'),
		}
	}

	private async fetchJourneyMap(
		signal?: AbortSignal,
	): Promise<Map<string, JourneyStatus>> {
		try {
			return await this.journeyService.listByUser(signal)
		} catch (err) {
			this.logger.warn('Journey fetch failed, continuing without statuses', {
				error: err,
			})
			return new Map()
		}
	}

	private async fetchFollowedArtistMap(
		signal?: AbortSignal,
	): Promise<Map<string, { artist: Artist; hype: Hype }>> {
		const followed = await this.followService.listFollowed(signal)
		const map = new Map<string, { artist: Artist; hype: Hype }>()
		for (const fa of followed) {
			const id = fa.artist.id?.value ?? ''
			if (id) {
				map.set(id, { artist: fa.artist, hype: fa.hype })
			}
		}
		return map
	}
}

const HYPE_ORDER: Record<HypeLevel, number> = {
	watch: 0,
	home: 1,
	nearby: 2,
	away: 3,
}
const LANE_ORDER: Record<LaneType, number> = { home: 1, nearby: 2, away: 3 }

export function isHypeMatched(hype: HypeLevel, lane: LaneType): boolean {
	return HYPE_ORDER[hype] >= LANE_ORDER[lane]
}

function protoConcertToEntity(
	concert: ProtoConcert,
	artistName: string,
	hypeLevel: HypeLevel,
	matched: boolean,
	artist?: Artist,
): Concert | null {
	const localDate = concert.localDate?.value
	if (!localDate) return null

	const jsDate = new Date(localDate.year, localDate.month - 1, localDate.day)

	const startTime = concert.startTime?.value
		? timestampToTimeString(Number(concert.startTime.value.seconds))
		: ''
	const openTime = concert.openTime?.value
		? timestampToTimeString(Number(concert.openTime.value.seconds))
		: undefined

	const venueName =
		concert.venue?.name?.value ?? concert.listedVenueName?.value ?? ''
	const adminArea = concert.venue?.adminArea?.value
	const locationLabel = adminArea ? displayName(adminArea) : ''

	return {
		id: concert.id?.value ?? '',
		artistName,
		artistId: concert.artistId?.value ?? '',
		venueName,
		locationLabel,
		adminArea,
		date: jsDate,
		startTime,
		openTime,
		title: concert.title?.value ?? '',
		sourceUrl: concert.sourceUrl?.value ?? '',
		hypeLevel,
		matched,
		artist,
	}
}

function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
