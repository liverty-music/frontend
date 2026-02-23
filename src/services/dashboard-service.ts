import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { PassionLevel } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import type {
	DateGroup,
	LiveEvent,
} from '../components/live-highway/live-event'
import { RegionSetupSheet } from '../components/region-setup-sheet/region-setup-sheet'
import { IArtistServiceClient } from './artist-service-client'
import { IConcertService } from './concert-service'

export const IDashboardService = DI.createInterface<IDashboardService>(
	'IDashboardService',
	(x) => x.singleton(DashboardService),
)

export interface IDashboardService extends DashboardService {}

export class DashboardService {
	private readonly logger = resolve(ILogger).scopeTo('DashboardService')
	private readonly concertService = resolve(IConcertService)
	private readonly artistService = resolve(IArtistServiceClient)

	public async loadDashboardEvents(signal?: AbortSignal): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')

		// Fetch followed artists (for name/passion mapping) and concerts in parallel
		const [artistMap, concerts] = await Promise.all([
			this.fetchFollowedArtistMap(signal),
			this.concertService.listByFollower(signal),
		])

		if (concerts.length === 0) {
			this.logger.info('No concerts found for followed artists')
			return []
		}

		const allEvents: LiveEvent[] = []
		for (const concert of concerts) {
			const artistId = concert.artistId?.value ?? ''
			const artist = artistMap.get(artistId)
			const event = this.concertToLiveEvent(
				concert,
				artist?.name ?? '',
				artist?.isMustGo ?? false,
			)
			if (event) allEvents.push(event)
		}

		allEvents.sort((a, b) => a.date.getTime() - b.date.getTime())
		return this.groupByDate(allEvents)
	}

	private async fetchFollowedArtistMap(
		signal?: AbortSignal,
	): Promise<Map<string, { name: string; isMustGo: boolean }>> {
		const client = this.artistService.getClient()
		const response = await client.listFollowed({}, { signal })
		const map = new Map<string, { name: string; isMustGo: boolean }>()
		for (const fa of response.artists) {
			const id = fa.artist?.id?.value ?? ''
			map.set(id, {
				name: fa.artist?.name?.value ?? '',
				isMustGo: fa.passionLevel === PassionLevel.MUST_GO,
			})
		}
		return map
	}

	private concertToLiveEvent(
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

		return {
			id: concert.id?.value ?? '',
			artistName,
			artistId: concert.artistId?.value ?? '',
			venueName,
			locationLabel: adminArea ?? '',
			adminArea,
			date: jsDate,
			startTime,
			openTime,
			title: concert.title?.value ?? '',
			sourceUrl: concert.sourceUrl?.value ?? '',
			isMustGo,
		}
	}

	private groupByDate(events: LiveEvent[]): DateGroup[] {
		const groups = new Map<string, DateGroup>()
		const userRegion = RegionSetupSheet.getStoredRegion()

		for (const event of events) {
			const dateKey = [
				event.date.getFullYear(),
				String(event.date.getMonth() + 1).padStart(2, '0'),
				String(event.date.getDate()).padStart(2, '0'),
			].join('-')
			const label = event.date.toLocaleDateString('ja-JP', {
				month: 'long',
				day: 'numeric',
				weekday: 'short',
			})

			let group = groups.get(dateKey)
			if (!group) {
				group = {
					label,
					dateKey,
					main: [],
					region: [],
					other: [],
				}
				groups.set(dateKey, group)
			}

			const lane = assignLane(event.adminArea, userRegion)
			group[lane].push(event)
		}

		return Array.from(groups.values()).sort((a, b) =>
			a.dateKey.localeCompare(b.dateKey),
		)
	}
}

// assignLane determines which dashboard lane an event belongs to.
// - main: event adminArea matches the user's stored region
// - region: event has an adminArea but differs from the user's region
// - other: event has no adminArea
function assignLane(
	adminArea: string | undefined,
	userRegion: string | null,
): 'main' | 'region' | 'other' {
	if (!adminArea) return 'other'
	if (!userRegion) return 'region'
	// Normalize: strip trailing 県/都/道/府 before comparing
	const normalize = (s: string) => s.replace(/[県都道府]$/, '')
	return normalize(adminArea) === normalize(userRegion) ? 'main' : 'region'
}

// timestampToTimeString converts Unix epoch seconds to a local "HH:MM" string.
function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
