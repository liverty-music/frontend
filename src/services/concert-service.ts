import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	IConcertRpcClient,
	type ProtoConcert,
	type ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { concertFrom } from '../adapter/rpc/mapper/concert-mapper'
import { codeToHome } from '../constants/iso3166'
import type { Artist } from '../entities/artist'
import {
	type DateGroup,
	type HypeLevel,
	type JourneyStatus,
	isHypeMatched,
	type LaneType,
} from '../entities/concert'
import type { Hype } from '../entities/follow'
import { IAuthService } from './auth-service'
import { IGuestService } from './guest-service'

export type { ProtoConcert, ProximityGroup }

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly authService = resolve(IAuthService)
	private readonly guest = resolve(IGuestService)
	private readonly rpcClient = resolve(IConcertRpcClient)

	@observable public artistsWithConcerts = new Set<string>()

	public get artistsWithConcertsCount(): number {
		return this.artistsWithConcerts.size
	}

	/**
	 * Add an artist to the set of artists with known concerts.
	 * Triggers Aurelia observation for the coach mark getter.
	 */
	public addArtistWithConcerts(artistId: string): void {
		this.artistsWithConcerts = new Set([...this.artistsWithConcerts, artistId])
	}

	// --- Existing RPC methods ---

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ProtoConcert[]> {
		return this.rpcClient.listConcerts(artistId, signal)
	}

	public async listByFollower(signal?: AbortSignal): Promise<ProximityGroup[]> {
		if (!this.authService.isAuthenticated) {
			return this.listByFollowerGuest(signal)
		}
		return this.rpcClient.listByFollower(signal)
	}

	public async listWithProximity(
		artistIds: readonly string[],
		countryCode: string,
		level1: string,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		return this.rpcClient.listWithProximity(
			[...artistIds],
			countryCode,
			level1,
			signal,
		)
	}

	/**
	 * Convert ProximityGroup[] into DateGroup[] for rendering.
	 * Shared by dashboard-route (authenticated) and welcome-route (preview).
	 */
	public toDateGroups(
		groups: ProximityGroup[],
		artistMap: Map<string, { artist: Artist; hype: Hype }>,
		journeyMap: Map<string, JourneyStatus> = new Map(),
	): DateGroup[] {
		return groups.map((g) =>
			this.protoGroupToDateGroup(g, artistMap, journeyMap),
		)
	}

	// --- Private ---

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

	private async listByFollowerGuest(
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const { follows, home: homeCode } = this.guest
		this.logger.info('Guest: listing concerts with proximity', {
			count: follows.length,
		})
		if (follows.length === 0 || !homeCode) return []

		const { countryCode, level1 } = codeToHome(homeCode)
		return this.rpcClient.listWithProximity(
			follows.map((a) => a.artist.id),
			countryCode,
			level1,
			signal,
		)
	}
}
