import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	IConcertRpcClient,
	type ProtoConcert,
	type ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { concertFrom } from '../adapter/rpc/mapper/concert-mapper'
import { loadFollows, loadHome } from '../adapter/storage/guest-storage'
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
import { CachedResource } from './cache/cached-resource'

export type { ProtoConcert, ProximityGroup }

interface ProximityInput {
	artistIds: readonly string[]
	countryCode: string
	level1: string
}

export const IConcertStore = DI.createInterface<IConcertStore>(
	'IConcertStore',
	(x) => x.singleton(ConcertStore),
)

export interface IConcertStore extends ConcertStore {}

export class ConcertStore {
	private readonly logger = resolve(ILogger).scopeTo('ConcertStore')
	private readonly authService = resolve(IAuthService)
	private readonly rpcClient = resolve(IConcertRpcClient)

	// The follower-concert list caching (was a bespoke in-store 24h TTL).
	// listByFollower serves the cached value; route follow/unfollow/setHype
	// invalidate through it; route entry + resume force a background revalidation.
	// Single key: one user per singleton session, so exactly one entry.
	private readonly followerConcerts = new CachedResource<
		void,
		ProximityGroup[]
	>(
		() => 'listByFollower',
		(_input, signal) => this.rpcClient.listByFollower(signal),
	)

	// The followed-artist map from the most recent successful dashboard load.
	// Stored here (not on DashboardRoute) because DashboardRoute is re-instantiated
	// on every navigation — storing it on the route component means it is always
	// null on re-entry and the fast-path never fires.
	private lastArtistMap: Map<string, { artist: Artist; hype: Hype }> | null =
		null

	// Guest / preview proximity list, keyed by the sorted artist-id set plus
	// country + level-1 area, so a changed follow set produces a new key (no
	// write-side invalidation needed).
	private readonly proximityConcerts = new CachedResource<
		ProximityInput,
		ProximityGroup[]
	>(
		({ artistIds, countryCode, level1 }) =>
			proximityKey(artistIds, countryCode, level1),
		({ artistIds, countryCode, level1 }, signal) =>
			this.rpcClient.listWithProximity(
				[...artistIds],
				countryCode,
				level1,
				signal,
			),
	)

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

	/**
	 * The follower-scoped concert list (authenticated) or the guest proximity
	 * list. Authenticated reads are served stale-while-revalidate from the shared
	 * primitive (24h stale window). A stale hit paints instantly and refreshes in
	 * the background; route entry / PWA resume force a refresh via
	 * {@link revalidateFollower}.
	 */
	public async listByFollower(signal?: AbortSignal): Promise<ProximityGroup[]> {
		if (!this.authService.isAuthenticated) {
			return this.listByFollowerGuest(signal)
		}
		return this.followerConcerts.read(undefined, signal)
	}

	/**
	 * Force a background refresh of the follower-concert list (authenticated) or
	 * the guest proximity list, regardless of staleness, and return the fresh
	 * value. Called on Dashboard route entry and PWA resume so a long-lived
	 * session refreshes without a manual reload. Runs as a forced background
	 * refresh, so it takes no `AbortSignal`.
	 */
	public async revalidateFollower(): Promise<ProximityGroup[]> {
		if (!this.authService.isAuthenticated) {
			// Guests read via proximity; force-refresh that same key so resume
			// actually refreshes instead of serving the still-fresh cached value.
			const input = this.guestProximityInput()
			return input ? this.proximityConcerts.revalidate(input) : []
		}
		return this.followerConcerts.revalidate(undefined)
	}

	/**
	 * Synchronous peek at the cached concert groups — null when absent. Used by
	 * the Dashboard fast-path to paint from cache before any RPC resolves.
	 */
	public peekFollowerGroups(): ProximityGroup[] | null {
		if (!this.authService.isAuthenticated) {
			const input = this.guestProximityInput()
			return (input && this.proximityConcerts.peek(input)) ?? null
		}
		return this.followerConcerts.peek(undefined) ?? null
	}

	/**
	 * Synchronous peek at the most recently fetched followed-artist map. Survives
	 * across `DashboardRoute` re-instantiations because this store is a singleton.
	 */
	public peekArtistMap(): Map<string, { artist: Artist; hype: Hype }> | null {
		return this.lastArtistMap
	}

	/** Record the latest followed-artist map so re-entry fast-paths can use it. */
	public setArtistMap(map: Map<string, { artist: Artist; hype: Hype }>): void {
		this.lastArtistMap = map
	}

	/** Whether a (possibly stale) concert list is cached for the current viewer. */
	public hasFollowerCache(): boolean {
		if (!this.authService.isAuthenticated) {
			const input = this.guestProximityInput()
			return input ? this.proximityConcerts.has(input) : false
		}
		return this.followerConcerts.has(undefined)
	}

	public invalidateFollowerCache(): void {
		this.followerConcerts.invalidate(undefined)
	}

	public async listWithProximity(
		artistIds: readonly string[],
		countryCode: string,
		level1: string,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		return this.proximityConcerts.read(
			{ artistIds, countryCode, level1 },
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
		const input = this.guestProximityInput()
		this.logger.info('Guest: listing concerts with proximity', {
			count: input?.artistIds.length ?? 0,
		})
		if (!input) return []
		return this.listWithProximity(
			input.artistIds,
			input.countryCode,
			input.level1,
			signal,
		)
	}

	/**
	 * Resolve the guest proximity inputs (followed artist ids + home area) from
	 * the localStorage adapter. Both are persisted synchronously by their
	 * @observable owners (FollowStore for follows, UserStore for home) on every
	 * write, so the adapter read reflects the latest value without a DI dependency
	 * on those stores — which would form a resolution cycle (FollowStore →
	 * ConcertStore). Returns null when the guest has no follows or no home yet.
	 */
	private guestProximityInput(): ProximityInput | null {
		const follows = loadFollows()
		const homeCode = loadHome()
		if (follows.length === 0 || !homeCode) return null
		const { countryCode, level1 } = codeToHome(homeCode)
		return {
			artistIds: follows.map((a) => a.artist.id),
			countryCode,
			level1,
		}
	}
}

/**
 * Complete cache key for `listWithProximity`: the sorted artist-id set plus
 * country and level-1 area. Sorting makes the key order-independent so the same
 * follow set always hits the same entry; a changed follow set (or area) yields a
 * new key, which is why this path needs no write-side invalidation.
 */
function proximityKey(
	artistIds: readonly string[],
	countryCode: string,
	level1: string,
): string {
	return `${[...artistIds].sort().join(',')}|${countryCode}|${level1}`
}
