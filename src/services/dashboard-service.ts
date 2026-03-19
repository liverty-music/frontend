import { DI, ILogger, resolve } from 'aurelia'
import type {
	ProtoConcert,
	ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { concertFrom } from '../adapter/rpc/mapper/concert-mapper'
import type { Artist } from '../entities/artist'
import type {
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
				const event = concertFrom(
					c,
					entry?.artist.name ?? '',
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
			const id = fa.artist.id
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
