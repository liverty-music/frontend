import { PassionLevel } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
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
		const followed = await this.artistService.listFollowed(signal)
		const map = new Map<string, { name: string; isMustGo: boolean }>()
		for (const fa of followed) {
			map.set(fa.id, {
				name: fa.name,
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

	private getUserHome(): string | null {
		if (this.authService.isAuthenticated) {
			// For authenticated users, read from cached user entity
			// The user's home is synced to the server via UpdateHome RPC
			try {
				const user = (this.authService as { user?: { home?: { level1?: string } } }).user
				if (user?.home?.level1) return user.home.level1
			} catch {
				// Fall through to guest storage
			}
		}
		return localStorage.getItem(StorageKeys.guestHome)
	}

	private groupByDate(events: LiveEvent[]): DateGroup[] {
		const groups = new Map<string, DateGroup>()
		const userHome = this.getUserHome()

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
