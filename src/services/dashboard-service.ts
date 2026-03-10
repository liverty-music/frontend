import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import type {
	DateGroup,
	LiveEvent,
} from '../components/live-highway/live-event'
import { displayName } from '../constants/iso3166'
import { StorageKeys } from '../constants/storage-keys'
import { IArtistServiceClient } from './artist-service-client'
import { IAuthService } from './auth-service'
import { IConcertService } from './concert-service'
import { IUserService } from './user-service'

export const IDashboardService = DI.createInterface<IDashboardService>(
	'IDashboardService',
	(x) => x.singleton(DashboardService),
)

export interface IDashboardService extends DashboardService {}

export class DashboardService {
	private readonly logger = resolve(ILogger).scopeTo('DashboardService')
	private readonly concertService = resolve(IConcertService)
	private readonly artistService = resolve(IArtistServiceClient)
	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)

	public async loadDashboardEvents(signal?: AbortSignal): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')

		// Fetch followed artists, concerts, and user home in parallel
		const [artistMap, concerts, userHome] = await Promise.all([
			this.fetchFollowedArtistMap(signal),
			this.concertService.listByFollower(signal),
			this.fetchUserHome(),
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
		return this.groupByDate(allEvents, userHome)
	}

	private async fetchFollowedArtistMap(
		signal?: AbortSignal,
	): Promise<Map<string, { name: string; isMustGo: boolean }>> {
		const followed = await this.artistService.listFollowed(signal)
		const map = new Map<string, { name: string; isMustGo: boolean }>()
		for (const fa of followed) {
			map.set(fa.id, {
				name: fa.name,
				isMustGo: fa.hype === HypeType.ANYWHERE,
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

	private async fetchUserHome(): Promise<string | null> {
		if (this.authService.isAuthenticated) {
			try {
				const resp = await this.userService.client.get({})
				const level1 = resp.user?.home?.level1
				if (level1) return level1
			} catch {
				this.logger.warn('Failed to fetch user home from backend')
			}
		}
		return localStorage.getItem(StorageKeys.guestHome)
	}

	private groupByDate(
		events: LiveEvent[],
		userHome: string | null,
	): DateGroup[] {
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

			let group = groups.get(dateKey)
			if (!group) {
				group = {
					label,
					dateKey,
					home: [],
					nearby: [],
					away: [],
				}
				groups.set(dateKey, group)
			}

			const lane = assignLane(event.adminArea, userHome)
			group[lane].push(event)
		}

		return Array.from(groups.values()).sort((a, b) =>
			a.dateKey.localeCompare(b.dateKey),
		)
	}
}

// assignLane determines which dashboard lane an event belongs to.
// - home: event adminArea matches the user's home (ISO 3166-2 code equality)
// - nearby: event has an adminArea but differs from the user's home
// - away: event has no adminArea
function assignLane(
	adminArea: string | undefined,
	userHome: string | null,
): 'home' | 'nearby' | 'away' {
	if (!adminArea) return 'away'
	if (!userHome) return 'nearby'
	return adminArea === userHome ? 'home' : 'nearby'
}

// timestampToTimeString converts Unix epoch seconds to a local "HH:MM" string.
function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
