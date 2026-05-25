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
	isHypeMatched,
	type JourneyStatus,
	type LaneType,
} from '../entities/concert'
import { DEFAULT_HYPE, type Hype } from '../entities/follow'
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

	private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000
	private cachedGroups: ProximityGroup[] | null = null
	private cacheTimestamp: number | null = null
	// Coalesces concurrent cache-miss calls onto a single RPC.
	private inFlightListByFollower: Promise<ProximityGroup[]> | null = null
	// Bumped on invalidate; in-flight .then() checks it to fence superseded cache writes.
	private cacheGeneration = 0

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
		const now = Date.now()
		if (
			this.cachedGroups !== null &&
			this.cacheTimestamp !== null &&
			now - this.cacheTimestamp < ConcertServiceClient.CACHE_TTL_MS
		) {
			return this.cachedGroups
		}
		// Signal-less callers coalesce safely; signal-bearing ones can't (shared promise honors only first caller's signal).
		if (this.inFlightListByFollower !== null && signal === undefined) {
			return await this.inFlightListByFollower
		}
		const generationAtIssue = this.cacheGeneration
		// `promise` is captured in both .then() (for the generation
		// fence) and .finally() (for the own-promise identity check
		// that prevents this stale finally from evicting a newer
		// in-flight registered post-invalidate).
		const promise: Promise<ProximityGroup[]> = this.rpcClient
			.listByFollower(signal)
			.then((result) => {
				// Skip cache write if invalidated since RPC issued.
				if (generationAtIssue === this.cacheGeneration) {
					this.cachedGroups = result
					this.cacheTimestamp = Date.now()
				}
				return result
			})
			.finally(() => {
				// Own-promise identity check: only clear the slot if
				// it still points at THIS promise. Without the guard,
				// a stale finally would clobber a post-invalidate
				// in-flight (RPC-2) that legitimately occupies the slot.
				if (this.inFlightListByFollower === promise) {
					this.inFlightListByFollower = null
				}
			})
		if (signal === undefined) {
			this.inFlightListByFollower = promise
		}
		return await promise
	}

	public invalidateFollowerCache(): void {
		this.cachedGroups = null
		this.cacheTimestamp = null
		this.cacheGeneration++
		// Post-invalidate callers must issue a fresh RPC, not join the now-stale in-flight.
		this.inFlightListByFollower = null
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
				// Concert proto v0.41.0+ exposes performers as a repeated
				// field. For follower-based listing the user may follow any
				// performer on the bill, not necessarily the headliner — a
				// festival concert can return with the followed support act
				// as performers[1+], so probe every performer and pick the
				// first one that resolves against the user's artistMap. The
				// resolved entry's Artist (with its id) is then forwarded to
				// concertFrom so the entity's artistId / artistName / artist
				// fields stay internally consistent — concertFrom reads the
				// artist arg first and only falls back to performers[0].id
				// when nothing was resolved.
				let entry: { artist: Artist; hype: Hype } | undefined
				for (const p of c.performers ?? []) {
					const candidate = p.id?.value ?? ''
					const candidateEntry = artistMap.get(candidate)
					if (candidateEntry) {
						entry = candidateEntry
						break
					}
				}
				if (!entry) {
					// Backend ListByFollower SHOULD only return concerts that
					// feature a followed artist; reaching here means an
					// ID-format mismatch or a backend bug. Log so the data
					// gap is investigable rather than silently producing a
					// blank artist card.
					console.warn(
						'[concert-service] no performer resolved against followedArtists; concert will render with empty artist context',
						{
							concertId: c.id?.value,
							performerIds: c.performers?.map((p) => p.id?.value),
						},
					)
				}
				const hypeLevel: HypeLevel = entry?.hype ?? DEFAULT_HYPE
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
