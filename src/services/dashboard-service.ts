import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import type { DateGroup, LiveEvent } from '../components/live-highway/live-event'
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

	public async loadDashboardEvents(
		signal?: AbortSignal,
	): Promise<DateGroup[]> {
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
		try {
			const client = this.artistService.getClient()
			const response = await client.listFollowed({}, { signal })
			return response.artists.map((a) => ({
				id: a.id?.value ?? '',
				name: a.name?.value ?? '',
			}))
		} catch (err) {
			this.logger.warn('Failed to fetch followed artists', { error: err })
			return []
		}
	}

	private async fetchConcertsForArtists(
		artists: Array<{ id: string; name: string }>,
		signal?: AbortSignal,
	): Promise<LiveEvent[]> {
		const artistMap = new Map(artists.map((a) => [a.id, a.name]))
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
		const date = concert.date
		if (!date) return null

		const jsDate = new Date(date.year, date.month - 1, date.day)
		const startTime = concert.startTime
			? `${String(concert.startTime.hours).padStart(2, '0')}:${String(concert.startTime.minutes).padStart(2, '0')}`
			: ''
		const openTime = concert.openTime
			? `${String(concert.openTime.hours).padStart(2, '0')}:${String(concert.openTime.minutes).padStart(2, '0')}`
			: undefined

		return {
			id: concert.id?.value ?? '',
			artistName,
			artistId: concert.artistId?.value ?? '',
			venueName: 'Venue TBD',
			locationLabel: '',
			date: jsDate,
			startTime,
			openTime,
			title: concert.title?.value ?? '',
			sourceUrl: concert.sourceUrl ?? '',
		}
	}

	private groupByDate(events: LiveEvent[]): DateGroup[] {
		const groups = new Map<string, DateGroup>()

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

			if (!groups.has(dateKey)) {
				groups.set(dateKey, {
					label,
					dateKey,
					main: [],
					region: [],
					other: [],
				})
			}

			const group = groups.get(dateKey)!
			// MVP: assign all events to main lane since venue location data is not yet available
			group.main.push(event)
		}

		return Array.from(groups.values()).sort((a, b) =>
			a.dateKey.localeCompare(b.dateKey),
		)
	}
}
