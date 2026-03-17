import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { ProximityGroup } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import { displayName } from '../constants/iso3166'
import type {
	Concert,
	DateGroup,
	HypeLevel,
	LaneType,
} from '../entities/concert'
import type { FollowedArtist } from '../entities/follow'
import { IConcertService } from './concert-service'
import { IFollowServiceClient } from './follow-service-client'

export const IDashboardService = DI.createInterface<IDashboardService>(
	'IDashboardService',
	(x) => x.singleton(DashboardService),
)

export interface IDashboardService extends DashboardService {}

export class DashboardService {
	private readonly logger = resolve(ILogger).scopeTo('DashboardService')
	private readonly concertService = resolve(IConcertService)
	private readonly followService = resolve(IFollowServiceClient)

	public async loadDashboardEvents(signal?: AbortSignal): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')

		const [artistMap, groups] = await Promise.all([
			this.fetchFollowedArtistMap(signal),
			this.concertService.listByFollower(signal),
		])

		if (groups.length === 0) {
			this.logger.info('No concert groups returned')
			return []
		}

		return groups.map((g) => this.protoGroupToDateGroup(g, artistMap))
	}

	private protoGroupToDateGroup(
		group: ProximityGroup,
		artistMap: Map<string, FollowedArtist>,
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
				const artist = artistMap.get(artistId)
				const hypeLevel: HypeLevel = artist?.hype ?? 'watch'
				const event = protoConcertToEntity(
					c,
					artist?.name ?? '',
					hypeLevel,
					isHypeMatched(hypeLevel, lane),
					artist?.logoUrl,
					artist?.backgroundUrl,
				)
				return event ? [event] : []
			})

		return {
			label,
			dateKey,
			home: convert(group.home, 'home'),
			nearby: convert(group.nearby, 'nearby'),
			away: convert(group.away, 'away'),
		}
	}

	private async fetchFollowedArtistMap(
		signal?: AbortSignal,
	): Promise<Map<string, FollowedArtist>> {
		const followed = await this.followService.listFollowed(signal)
		const map = new Map<string, FollowedArtist>()
		for (const fa of followed) {
			map.set(fa.id, fa)
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
	logoUrl?: string,
	backgroundUrl?: string,
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
		logoUrl,
		backgroundUrl,
	}
}

function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
