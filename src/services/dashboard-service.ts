import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import type { DateLaneGroup } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import type {
	DateGroup,
	LiveEvent,
} from '../components/live-highway/live-event'
import { displayName } from '../constants/iso3166'
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
		group: DateLaneGroup,
		artistMap: Map<string, { name: string; isMustGo: boolean }>,
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

		const convert = (concerts: Concert[]) =>
			concerts.flatMap((c) => {
				const artistId = c.artistId?.value ?? ''
				const artist = artistMap.get(artistId)
				const event = concertToLiveEvent(
					c,
					artist?.name ?? '',
					artist?.isMustGo ?? false,
				)
				return event ? [event] : []
			})

		return {
			label,
			dateKey,
			home: convert(group.home),
			nearby: convert(group.nearby),
			away: convert(group.away),
		}
	}

	private async fetchFollowedArtistMap(
		signal?: AbortSignal,
	): Promise<Map<string, { name: string; isMustGo: boolean }>> {
		const followed = await this.followService.listFollowed(signal)
		const map = new Map<string, { name: string; isMustGo: boolean }>()
		for (const fa of followed) {
			map.set(fa.id, {
				name: fa.name,
				isMustGo: fa.hype === HypeType.ANYWHERE,
			})
		}
		return map
	}
}

function concertToLiveEvent(
	concert: Concert,
	artistName: string,
	isMustGo: boolean,
): LiveEvent | null {
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
		isMustGo,
	}
}

function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
