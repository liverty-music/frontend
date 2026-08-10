import { DI, ILogger, observable, resolve } from 'aurelia'
import {
	type CalendarDate,
	IConcertRpcClient,
	type ProtoConcert,
	type ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { loadFollows, loadHome } from '../adapter/storage/guest-storage'
import { codeToHome, displayName } from '../constants/iso3166'
import type { Artist } from '../entities/artist'
import {
	type Concert,
	type DateGroup,
	type HypeLevel,
	isHypeMatched,
	type JourneyStatus,
	type LaneType,
} from '../entities/concert'
import { DEFAULT_HYPE, type Hype } from '../entities/follow'
import type { GeoLocationInit } from '../entities/user'
import { IAuthService } from './auth-service'
import { CachedResource } from './cache/cached-resource'
import { IUserStore } from './user-store'

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
	private readonly userStore = resolve(IUserStore)

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

	// The rendered DateGroup[] from the most recent successful dashboard load.
	// Stored here (not on DashboardRoute) because DashboardRoute is re-instantiated
	// on every navigation. On re-entry this is painted immediately (no spinner);
	// a background refresh then replaces it with fresh data.
	// Cleared on invalidateFollowerCache() so a follow/unfollow always shows
	// a fresh load rather than stale groups.
	private lastDateGroups: DateGroup[] | null = null

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
			this.rpcClient.listByArtists([...artistIds], countryCode, level1, signal),
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
	 * Synchronous peek at the last successfully rendered concert groups for this
	 * user. Survives across `DashboardRoute` re-instantiations because this store
	 * is a singleton. Non-null after any successful dashboard load.
	 */
	public peekDateGroups(): DateGroup[] | null {
		return this.lastDateGroups
	}

	/**
	 * Persist the latest rendered concert groups so the next DashboardRoute
	 * instance (re-instantiated on re-entry) can paint immediately.
	 */
	public setDateGroups(groups: DateGroup[]): void {
		this.lastDateGroups = groups
	}

	public invalidateFollowerCache(): void {
		this.followerConcerts.invalidate(undefined)
		// Clear the cached output too so the next visit shows a fresh spinner
		// rather than stale groups with the unfollowed/newly-followed artist.
		this.lastDateGroups = null
	}

	public async listByArtists(
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
	 * The "All Nearby" concert list: every catalog concert HOME/NEARBY to a
	 * geographic reference point within a date range. Unlike the follower/artist
	 * paths this is not cached here — the Dashboard route owns a route-local cache
	 * keyed by (area, date range) so it stays separate from the My Timetable cache.
	 */
	public async listByLocation(
		location: GeoLocationInit,
		from: CalendarDate,
		to: CalendarDate,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		return this.rpcClient.listByLocation(location, from, to, signal)
	}

	/**
	 * Convert All Nearby ProximityGroup[] into DateGroup[], resolving each card's
	 * artist identity from the concert's OWN performers.
	 *
	 * The follower/artist paths resolve performers against the user's followed-artist
	 * map; in All Nearby the concerts belong to arbitrary catalog artists the user
	 * does not follow, so that map is empty and every card would render a blank
	 * artist name (only the location showed). Building the map from the proto
	 * performers themselves makes the headliner name render. No hype/journey context
	 * applies here, so hype defaults and the journey map is empty.
	 */
	public toDateGroupsForLocation(groups: ProximityGroup[]): DateGroup[] {
		const artistMap = new Map<string, { artist: Artist; hype: Hype }>()
		for (const g of groups) {
			for (const c of [...g.home, ...g.nearby, ...g.away]) {
				for (const p of c.performers ?? []) {
					const id = p.id?.value
					if (!id || artistMap.has(id)) continue
					artistMap.set(id, {
						artist: {
							id,
							name: p.name?.value ?? '',
							mbid: p.mbid?.value ?? '',
						},
						hype: DEFAULT_HYPE,
					})
				}
			}
		}
		return this.toDateGroups(groups, artistMap, new Map())
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
		let lastMonthKey = ''
		return groups.map((g) => {
			const group = this.protoGroupToDateGroup(g, artistMap, journeyMap)
			const monthKey = group.dateKey.slice(0, 7) // "2026-07"
			const isFirstOfMonth = monthKey !== '' && monthKey !== lastMonthKey
			if (isFirstOfMonth) lastMonthKey = monthKey
			let monthSeparatorLabel = ''
			if (isFirstOfMonth) {
				const [year, month] = monthKey.split('-').map(Number)
				monthSeparatorLabel = new Date(year, month - 1, 1).toLocaleDateString(
					'ja-JP',
					{ year: 'numeric', month: 'long' },
				)
			}
			return { ...group, isFirstOfMonth, monthSeparatorLabel }
		})
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
				// fallback — leaving all three fields empty keeps artistId /
				// artistName / artist internally consistent; a partial fill
				// (e.g. artistId from headliner while name is blank) would
				// silently break dashboard filters and card rendering).
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
					this.userStore.currentLanguage,
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
			isFirstOfMonth: false,
			monthSeparatorLabel: '',
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
		return this.listByArtists(
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
 * Complete cache key for `listByArtists`: the sorted artist-id set plus
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

/**
 * Map a ProtoConcert proto to a Concert UI entity.
 *
 * Returns null when the proto has no usable local date (missing or any
 * zero component — a proto3-defaulted field with month=0 would roll
 * `new Date(2026, -1, 15)` to 2025-12-15 and misbucket the concert).
 *
 * `artistId` uses `||` (not `??`) so an empty-string Artist.id is treated
 * the same as absent, keeping the artistId / artistName / artist trio
 * symmetric: all populated or all empty.
 */
function concertFrom(
	proto: ProtoConcert,
	artistName: string,
	hypeLevel: HypeLevel,
	matched: boolean,
	artist?: Artist,
	lang = 'en',
): Concert | null {
	const localDate = proto.localDate?.value
	if (!localDate) return null
	if (localDate.year === 0 || localDate.month === 0 || localDate.day === 0) {
		return null
	}

	const jsDate = new Date(localDate.year, localDate.month - 1, localDate.day)

	const startTime = proto.startTime?.value
		? timestampToTimeString(Number(proto.startTime.value.seconds))
		: ''
	const openTime = proto.openTime?.value
		? timestampToTimeString(Number(proto.openTime.value.seconds))
		: undefined

	const venueName = resolveVenueName(
		proto.venue?.name?.value,
		proto.listedVenueName?.value,
		lang,
	)
	const adminArea = proto.venue?.adminArea?.value
	const locationLabel = adminArea ? displayName(adminArea) : ''

	// proto.series is guaranteed non-null on Concert by the v0.41.0+ BSR
	// schema (required field). The `?.` chain is defensive against
	// proto3's permissive-field-default typing, NOT a fallback for a
	// legitimately series-less concert.
	return {
		id: proto.id?.value ?? '',
		artistName,
		artistId: artist?.id || '',
		venueName,
		locationLabel,
		date: jsDate,
		startTime,
		openTime,
		title: proto.series?.title?.value ?? '',
		sourceUrl: proto.series?.sourceUrl?.value ?? '',
		merchUrl: proto.series?.merchUrl?.value ?? '',
		hypeLevel,
		matched,
		artist,
	}
}

// resolveVenueName picks the venue display name based on the viewer's language.
// Japanese users prefer listed_venue_name (scraped from the official Japanese site);
// English users prefer venue.name (Google Places canonical). Each direction falls
// back to the other field when the preferred field is absent.
function resolveVenueName(
	venueName: string | undefined,
	listedVenueName: string | undefined,
	lang = 'en',
): string {
	if (lang === 'ja') {
		return listedVenueName || venueName || ''
	}
	return venueName || listedVenueName || ''
}

function timestampToTimeString(epochSeconds: number): string {
	const d = new Date(epochSeconds * 1000)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
