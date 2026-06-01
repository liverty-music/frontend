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

export const IConcertStore = DI.createInterface<IConcertStore>(
	'IConcertStore',
	(x) => x.singleton(ConcertStore),
)

export interface IConcertStore extends ConcertStore {}

export class ConcertStore {
	private readonly logger = resolve(ILogger).scopeTo('ConcertStore')
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
			now - this.cacheTimestamp < ConcertStore.CACHE_TTL_MS
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
		// Same zero-component guard concertFrom applies to per-concert
		// dates — a proto3-defaulted ProximityGroup.date with any zero
		// field would roll `new Date(2026, -1, 15)` to 2025-12-15 and
		// produce a malformed `2026-00-15` dateKey, silently
		// misbucketing the whole group. Treat any zero component as
		// unpopulated and fall back to today / empty key.
		const rawLd = group.date?.value
		const ld =
			rawLd && rawLd.year !== 0 && rawLd.month !== 0 && rawLd.day !== 0
				? rawLd
				: undefined
		const jsDate = ld ? new Date(ld.year, ld.month - 1, ld.day) : new Date()

		const dateKey = ld
			? `${ld.year}-${String(ld.month).padStart(2, '0')}-${String(ld.day).padStart(2, '0')}`
			: ''

		const label = jsDate.toLocaleDateString('ja-JP', {
			month: 'long',
			day: 'numeric',
			weekday: 'short',
		})

		// unresolved collects concerts whose performers don't resolve in
		// artistMap so we can emit a single batched warn at the end of
		// this group instead of one per concert. A systematic mismatch
		// (wrong ID namespace, schema-skew rollout window) could produce
		// O(N) entries per page load and flood any remote log sink or
		// OTEL exporter; one entry per call with the full list is equally
		// actionable but bounded.
		//
		// Each entry carries the lane the failure originated in so on-call
		// can distinguish "all failures in away" (proximity-based, often
		// expected) from "failures in home" (followed-artist mismatch,
		// suspicious). Dedup keys on `${id}|${lane}` rather than id alone:
		// a backend bug echoing the same concert proto across lanes is
		// itself useful diagnostic signal (one entry per lane it appeared
		// in), and within-lane re-pushes from the flatMap (impossible
		// today but cheap to defend) still collapse to one entry.
		const unresolved: Array<{ id: string; lane: LaneType }> = []
		const unresolvedSeen = new Set<string>()
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
				// fields stay internally consistent. When no Artist is
				// resolved all three fields are left blank (no headliner
				// fallback — see concert-mapper.ts for why symmetric blanks
				// are required).
				// Tiebreaker note: when the user follows multiple
				// performers on the same bill (e.g. both the headliner
				// and a support act), the FIRST matched performer wins —
				// the loop breaks on the first hit. Order is whatever
				// the backend serialised in `performers[]`, which is the
				// billing/series order today. A more nuanced policy
				// (e.g. "highest hype tier wins") would require ranking
				// candidates instead of breaking on first match; intent
				// today is "first listed performer the user follows = the
				// primary identity for this card", consistent with the
				// dashboard's single-artist-per-row model.
				let entry: { artist: Artist; hype: Hype } | undefined
				for (const p of c.performers ?? []) {
					// Skip performers whose id is missing/empty — otherwise an
					// `artistMap.get('')` would spuriously resolve if any
					// followed artist happens to be stored under a blank key
					// (a backend bug, but cheap to defend against here).
					const candidate = p.id?.value
					if (!candidate) continue
					const candidateEntry = artistMap.get(candidate)
					if (candidateEntry) {
						entry = candidateEntry
						break
					}
				}
				if (!entry) {
					// Skip blank ids — a `''` entry is indistinguishable
					// from "one more unresolved" and gives on-call nothing
					// to grep for. Dedup by (id, lane) so a concert echoed
					// across lanes (a backend bug) emits one entry per lane
					// it appeared in (useful signal) instead of collapsing
					// to whichever lane the flatMap reached first. The
					// concert itself is still processed by concertFrom
					// below; only the diagnostic entry is deduped.
					const concertId = c.id?.value
					if (concertId) {
						const key = `${concertId}|${lane}`
						if (!unresolvedSeen.has(key)) {
							unresolvedSeen.add(key)
							unresolved.push({ id: concertId, lane })
						}
					}
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

		const result = {
			label,
			dateKey,
			home: convert(group.home, 'home'),
			nearby: convert(group.nearby, 'nearby'),
			away: convert(group.away, 'away'),
		}
		if (unresolved.length > 0) {
			// Single batched warn per group; backend ListByFollower SHOULD
			// only return concerts that feature a followed artist, so any
			// non-empty list here is a real signal (ID-format mismatch or
			// schema-skew rollout). Use the scoped Aurelia logger so the
			// entry flows through whatever log sink / OpenTelemetry
			// exporter the class is configured with.
			this.logger.warn(
				'some concerts had no performer resolved against followedArtists; they will either render with empty artist context or be dropped entirely by concertFrom (e.g. a zero-component localDate)',
				{
					count: unresolved.length,
					concertIds: unresolved.map((u) => u.id),
					lanes: unresolved.map((u) => u.lane),
					dateKey,
				},
			)
		}
		return result
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
