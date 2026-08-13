import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import type { Artist } from '../entities/artist'
import { detectCountryFromTimezone } from '../util/detect-country'
import { IArtistStore } from './artist-store'
import {
	capTo,
	dedupById,
	excludeFollowed,
	MAX_BUBBLES,
	SeenTracker,
} from './bubble-invariants'
import { SignedOut } from './events/signed-out'
import { IFollowStore } from './follow-store'

export const IArtistBubbleStore = DI.createInterface<IArtistBubbleStore>(
	'IArtistBubbleStore',
	(x) => x.singleton(ArtistBubbleStore),
)

export interface IArtistBubbleStore extends ArtistBubbleStore {}

/** Position a tap-added bubble spawns from (canvas coordinates). */
export interface Placement {
	x: number
	y: number
}

/**
 * The single owner of the Discovery display FIELD — the authoritative
 * `Artist[]` set of artists currently on the canvas, and the SINGLE bubble-field
 * cache. Every other representation (the physics bodies) is a derived projection
 * of this field; nothing else holds authoritative membership. `ArtistStore`
 * keeps only the raw `listTop` SWR cache — the display field is not duplicated
 * there.
 *
 * "Bubble" in the name is this feature's ubiquitous language (`bubble-physics`,
 * ...). The store owns `Artist[]`, NOT physics bodies — those are reconciled by
 * the canvas from the field snapshot.
 *
 * It also owns the fetch orchestration folded out of the retired per-route
 * `BubbleManager` (initial load, seed-similar + top-up, reset/genre, similar-on-
 * tap, replacement recovery) so fetch + invariants + state have one owner, and
 * applies the field invariants (exclude-followed + dedup + 50-cap) in exactly
 * one place (`setField` / `addAt`) — downstream consumers never re-apply them.
 *
 * App-lifetime DI singleton: its `field` survives the per-route component churn,
 * so it IS the in-session field cache (no second snapshot). Per-visit and
 * per-user state is reset explicitly (see `enterRoute` and `SignedOut`).
 */
export class ArtistBubbleStore {
	private static readonly SIMILAR_LIMIT_ON_TAP = 30
	private static readonly MAX_SEED_ARTISTS = 5
	// Below this many seed-similar results, top up the initial field with global
	// top artists so it stays full regardless of follow count.
	private static readonly SEED_SIMILAR_TARGET = 30
	// Re-entry keeps the in-session field intact as long as its data is at least
	// this full after removing artists followed while away; below it, the field is
	// topped up to this floor (never a wholesale re-roll). Kept under a healthy
	// field size (SEED_SIMILAR_TARGET) so a full field is preserved untouched.
	private static readonly DISPLAY_FLOOR = 30
	// Session-scoped freshness window for reusing the field on re-entry. Within
	// it, re-entry applies a non-destructive delta; past it, re-entry does a full
	// cold-style reload so recommendations refresh periodically. Distinct from the
	// raw listTop SWR staleTime (24h) — this governs field reuse, not the RPC cache.
	private static readonly FIELD_REUSE_TTL_MS = 15 * 60 * 1000

	private readonly artists = resolve(IArtistStore)
	private readonly followStore = resolve(IFollowStore)
	private readonly ea = resolve(IEventAggregator)
	private readonly logger = resolve(ILogger).scopeTo('ArtistBubbleStore')

	/**
	 * The display field: a frozen snapshot reassigned on every update. The canvas
	 * binds `artists.bind="field"`; a NEW reference guarantees `artistsChanged`
	 * fires deterministically (Aurelia's `[bindable]Changed` reacts to reference
	 * change, not in-place mutation).
	 */
	@observable public field: readonly Artist[] = []

	/**
	 * Spawn-origin hints for the ids most recently added by `addAt`, consumed by
	 * the canvas reconcile to animate a tap top-up outward from the tap point.
	 * Reassigned (with the field) so the canvas' `placements` binding updates
	 * before `artistsChanged` runs; empty for every non-tap update.
	 */
	@observable public pendingPlacements: ReadonlyMap<string, Placement> =
		new Map()

	// Cross-fetch dedup memory (shown/retired ids) — prevents a later top-up from
	// re-surfacing artists already displayed this session.
	private readonly seen = new SeenTracker()
	private country = detectCountryFromTimezone()
	private isLoading = false
	// Wall-clock (ms) of the last full field FETCH (loadInitial/loadTop) — NOT
	// bumped by a cache repaint or a re-entry delta, so freshness reflects when the
	// data was last fetched. Drives the re-entry reuse-vs-reload decision.
	private fieldBuiltAt = 0

	constructor() {
		// A shared singleton must not leak one user's field/dedup memory to the
		// next visitor on the same browser. Clear on the same SignedOut event
		// FollowStore already handles.
		this.ea.subscribe(SignedOut, () => this.clear())
	}

	/**
	 * Per-visit reset run from the router `loading()` hook: re-detect the country
	 * for this entry. The field is intentionally NOT cleared — this app-singleton
	 * IS the single bubble-field cache, so its `field` persists across the route
	 * component churn and backs the instant re-entry paint. It is refreshed via a
	 * background `reenter` (non-destructive delta when fresh, full reload stale).
	 */
	public enterRoute(): void {
		this.country = detectCountryFromTimezone()
	}

	/**
	 * Prepare the field for a route entry (called synchronously from `loading()`).
	 * Cold visit (no real field yet) → ghost placeholders so the canvas is never
	 * blank while `loadInitial` fetches. Re-entry → re-apply the invariants to the
	 * persisted field so artists followed while away are dropped from the instant
	 * paint before the canvas re-attaches; the background `reenter` then applies
	 * the full non-destructive delta.
	 */
	public prepareEntry(): void {
		const real = this.realField()
		if (real.length === 0) {
			this.paintGhosts()
		} else {
			this.setField(real)
		}
	}

	/**
	 * Cold-visit placeholder: fill the field with ghost bubbles so the canvas is
	 * never blank while `loadInitial` fetches. Ghosts bypass the invariants (they
	 * are not real artists and must not be tracked as seen).
	 */
	public paintGhosts(): void {
		this.commitField(makeGhostArtists(MAX_BUBBLES), new Map())
	}

	/**
	 * Load the initial field: global top artists when nothing is followed, else
	 * seed-similar from the followed artists topped up with top artists so the
	 * field stays full regardless of follow count. The result lives in `field`
	 * (this singleton is the cache). Guarded against concurrent loads.
	 */
	public async loadInitial(): Promise<void> {
		if (this.isLoading) return
		this.isLoading = true
		try {
			const followedArtists = this.followStore.followedArtists
			this.logger.info('Loading initial field', {
				country: this.country,
				followed: followedArtists.length,
			})
			this.seen.resetWith(followedArtists)

			const raw =
				followedArtists.length === 0
					? await this.artists.listTop(this.country, '', MAX_BUBBLES)
					: await this.fetchSeedSimilar(followedArtists)

			let next = this.freshFrom(raw)

			// Top up sparse seed-similar results with global top artists so the
			// field stays full (more follows → narrower similar lists → heavier
			// dedup). Similar artists keep priority; popular artists fill the rest.
			if (
				followedArtists.length > 0 &&
				next.length < ArtistBubbleStore.SEED_SIMILAR_TARGET
			) {
				this.logger.info('Seed-similar sparse, topping up with top artists', {
					similarCount: next.length,
				})
				this.seen.trackAll(next)
				const top = await this.artists.listTop(this.country, '', MAX_BUBBLES)
				next = capTo([...next, ...this.freshFrom(top)], MAX_BUBBLES)
			}

			this.setField(next)
			this.fieldBuiltAt = Date.now()
		} finally {
			this.isLoading = false
		}
	}

	/**
	 * Re-entry field refresh (router `loading()` background). Preserves the
	 * in-session field instead of re-rolling it: when the field's data is still
	 * fresh (within the reuse TTL), apply only a non-destructive delta — remove
	 * artists followed while away, and top up to the display floor ONLY if the
	 * field fell below it. When stale or empty, fall back to a full cold-style
	 * reload. This replaces the old unconditional wholesale background reload.
	 */
	public async reenter(): Promise<void> {
		const real = this.realField()
		const fresh =
			real.length > 0 &&
			Date.now() - this.fieldBuiltAt < ArtistBubbleStore.FIELD_REUSE_TTL_MS
		if (!fresh) {
			await this.loadInitial()
			return
		}
		if (this.isLoading) return
		this.isLoading = true
		try {
			// Keep the visible field; drop only artists followed while away.
			let next = excludeFollowed(real, this.followStore.followedIds)
			// Top up ONLY when the field fell below the floor (e.g. follows thinned
			// it) — never a wholesale re-fetch that recomposes a healthy field.
			if (next.length < ArtistBubbleStore.DISPLAY_FLOOR) {
				this.logger.info('Re-entry field below floor, topping up', {
					count: next.length,
				})
				this.seen.trackAll(next)
				const top = await this.artists.listTop(this.country, '', MAX_BUBBLES)
				next = capTo(
					[...next, ...this.freshFrom(top)],
					ArtistBubbleStore.DISPLAY_FLOOR,
				)
			}
			this.seen.trackAll(next)
			this.commitField(next, new Map())
		} finally {
			this.isLoading = false
		}
	}

	/**
	 * Reset the field to the global top artists, independent of follows (the
	 * reset control). Always the global-top path — never seed-similar.
	 */
	public async reset(): Promise<void> {
		await this.loadTop(this.country, '')
	}

	/**
	 * Replace the field with the top artists for a country/tag (the genre chips
	 * and the reset control). Clears the dedup memory so a fresh context can
	 * re-surface previously-seen artists.
	 */
	public async loadTop(country: string, tag: string): Promise<void> {
		this.logger.info('Loading top field', { country, tag })
		this.seen.resetWith(this.followStore.followedArtists)
		const raw = await this.artists.listTop(country, tag, MAX_BUBBLES)
		this.setField(raw)
		this.fieldBuiltAt = Date.now()
	}

	/**
	 * Fetch similar artists for a tapped bubble and top up the field, animating
	 * the additions outward from the tap position. Falls back to top artists when
	 * similar is exhausted so the field refills instead of firing the
	 * "unavailable" snack. Guarded against concurrent loads (rapid taps). Returns
	 * whether any bubble was added.
	 */
	public async loadSimilar(artistId: string, pos: Placement): Promise<boolean> {
		if (this.isLoading) return false
		this.isLoading = true
		try {
			const similar = await this.artists.listSimilar(
				artistId,
				ArtistBubbleStore.SIMILAR_LIMIT_ON_TAP,
			)
			let fresh = this.freshFrom(similar)

			if (fresh.length === 0) {
				// Similar exhausted: narrow the seen memory to the visible field and
				// refill from top artists.
				this.logger.info('Similar exhausted, loading replacement top artists')
				this.seen.resetWith(this.realField())
				const top = await this.artists.listTop(this.country, '', MAX_BUBBLES)
				fresh = this.freshFrom(top)
			}

			if (fresh.length === 0) return false

			const added = this.addAt(fresh, pos)
			return added.length > 0
		} finally {
			this.isLoading = false
		}
	}

	/**
	 * Top up the field with new candidates, animating them from `pos`. FIFO: the
	 * candidates win and the OLDEST existing bubbles are evicted to make room (the
	 * opposite of `setField`, which protects the visible field). Returns the
	 * artists actually added.
	 */
	public addAt(candidates: Artist[], pos?: Placement): Artist[] {
		const fresh = this.freshFrom(candidates)
		if (fresh.length === 0) return []
		this.seen.trackAll(fresh)

		const existing = this.realField()
		// existing (oldest→newest) first, fresh appended; dedup drops any fresh
		// already present. Over cap → drop the oldest existing from the front,
		// never the fresh candidates.
		const merged = dedupById([...existing, ...fresh])
		const overflow = Math.max(0, merged.length - MAX_BUBBLES)
		const next = overflow > 0 ? merged.slice(overflow) : merged

		const nextIds = new Set(next.map((n) => n.id))
		const added = fresh.filter((a) => nextIds.has(a.id))
		const placements = new Map<string, Placement>()
		if (pos) {
			for (const a of added) placements.set(a.id, pos)
		}
		this.commitField(next, placements)
		return added
	}

	/**
	 * Remove an artist from the field (e.g. after being followed). The canvas
	 * reconcile fades the corresponding body out.
	 */
	public remove(artistId: string): void {
		if (!this.field.some((a) => a.id === artistId)) return
		this.commitField(
			this.field.filter((a) => a.id !== artistId),
			new Map(),
		)
	}

	// --- Internals ---

	/**
	 * The ONLY full-replace field mutation: apply the invariants once (dedup +
	 * exclude-followed + tail-drop cap, keep-priority) and publish an immutable
	 * snapshot. Clears any pending tap placements.
	 */
	private setField(candidates: readonly Artist[]): void {
		const next = capTo(
			excludeFollowed(dedupById(candidates), this.followStore.followedIds),
			MAX_BUBBLES,
		)
		this.seen.trackAll(next)
		this.commitField(next, new Map())
	}

	/** Publish placements then the frozen field so the canvas sees both together. */
	private commitField(
		next: readonly Artist[],
		placements: ReadonlyMap<string, Placement>,
	): void {
		this.pendingPlacements = placements
		this.field = Object.freeze([...next])
	}

	/** Real (non-ghost) artists currently on the field. */
	private realField(): Artist[] {
		return this.field.filter((a) => !a.isGhost)
	}

	/** Unseen, unfollowed, intra-deduped candidates from a raw fetch. */
	private freshFrom(raw: readonly Artist[]): Artist[] {
		return dedupById(
			excludeFollowed(
				this.seen.filterUnseen(raw),
				this.followStore.followedIds,
			),
		)
	}

	private async fetchSeedSimilar(followedArtists: Artist[]): Promise<Artist[]> {
		const seeds = this.pickRandomSeeds(followedArtists)
		const limitPerSeed = Math.floor(MAX_BUBBLES / seeds.length)
		this.logger.info('Fetching seed-similar artists', {
			seedCount: seeds.length,
			limitPerSeed,
		})
		const results = await Promise.all(
			seeds.map((seed) =>
				this.artists.listSimilar(seed.id, limitPerSeed).catch((err) => {
					this.logger.warn('Seed similar fetch failed', {
						seed: seed.name,
						error: err,
					})
					return [] as Artist[]
				}),
			),
		)
		return results.flat()
	}

	private pickRandomSeeds(followedArtists: Artist[]): Artist[] {
		const max = ArtistBubbleStore.MAX_SEED_ARTISTS
		if (followedArtists.length <= max) return [...followedArtists]
		const shuffled = [...followedArtists]
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
		}
		return shuffled.slice(0, max)
	}

	/** Clear all per-user/per-visit state (sign-out). */
	private clear(): void {
		this.seen.clear()
		this.country = detectCountryFromTimezone()
		this.fieldBuiltAt = 0
		this.commitField([], new Map())
		this.logger.info('Bubble field cleared')
	}
}

/** Create N placeholder ghost artists for the pre-load skeleton. */
function makeGhostArtists(count: number): Artist[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `__ghost__${i}`,
		name: '',
		mbid: '',
		isGhost: true as const,
	}))
}
