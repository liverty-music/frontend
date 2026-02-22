import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
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

		const artists = await this.fetchFollowedArtists(signal)
		if (artists.length === 0) {
			this.logger.info('No followed artists found')
			return []
		}

		const allEvents = await this.fetchConcertsForArtists(artists, signal)
		return this.groupByDate(allEvents)
	}

	private async fetchFollowedArtists(
		signal?: AbortSignal,
	): Promise<Array<{ id: string; name: string }>> {
		const client = this.artistService.getClient()
		const response = await client.listFollowed({}, { signal })
		return response.artists.map((a) => ({
			id: a.id?.value ?? '',
			name: a.name?.value ?? '',
		}))
	}

	private async fetchConcertsForArtists(
		artists: Array<{ id: string; name: string }>,
		signal?: AbortSignal,
	): Promise<LiveEvent[]> {
		const results: LiveEvent[] = []

		const settled = await Promise.allSettled(
			artists.map((artist) =>
				this.concertService.listConcerts(artist.id, signal),
			),
		)

		for (let i = 0; i < settled.length; i++) {
			const result = settled[i]
			if (result.status === 'fulfilled') {
				const artist = artists[i]
				for (const concert of result.value) {
					const event = this.concertToLiveEvent(concert, artist.name)
					if (event) results.push(event)
				}
			}
		}

		results.sort((a, b) => a.date.getTime() - b.date.getTime())
		return results
	}

	private concertToLiveEvent(
		concert: Concert,
		artistName: string,
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
