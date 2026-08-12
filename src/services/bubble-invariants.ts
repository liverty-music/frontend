import type { Artist } from '../entities/artist'

/**
 * The bubble-field invariants, extracted as pure functions + a stateful seen
 * tracker so the field owner (`ArtistBubbleStore`) applies them in exactly ONE
 * place. The physics/canvas layer and the route flows MUST NOT re-apply these.
 *
 * These replace the membership/dedup/cap logic that used to live in the retired
 * `BubblePool` (a second authoritative copy of the field). `MAX_BUBBLES` also
 * moves here so `bubble-physics.ts` can import the hard safety ceiling without a
 * dependency on the old pool.
 */

/** Maximum number of bubbles on the discovery field at once. */
export const MAX_BUBBLES = 50

/** Normalize an artist name for case/whitespace-insensitive comparison. */
export function normalizeName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Remove intra-array duplicates by id, then normalized name, then mbid — the
 * first occurrence wins. Unlike the old `BubblePool.dedup` (which only filtered
 * against an external seen-set and let same-array duplicates through — the
 * shipped "Vaundy×3" bug where seed-similar `results.flat()` merged cross-seed
 * dupes), this de-duplicates WITHIN the input.
 */
export function dedupById(artists: readonly Artist[]): Artist[] {
	const seenIds = new Set<string>()
	const seenNames = new Set<string>()
	const seenMbids = new Set<string>()
	const out: Artist[] = []
	for (const a of artists) {
		const id = a.id
		const name = a.name ? normalizeName(a.name) : ''
		const mbid = a.mbid
		if (id && seenIds.has(id)) continue
		if (name && seenNames.has(name)) continue
		if (mbid && seenMbids.has(mbid)) continue
		if (id) seenIds.add(id)
		if (name) seenNames.add(name)
		if (mbid) seenMbids.add(mbid)
		out.push(a)
	}
	return out
}

/** Drop artists the user already follows. */
export function excludeFollowed(
	artists: readonly Artist[],
	followedIds: ReadonlySet<string>,
): Artist[] {
	return artists.filter((a) => !followedIds.has(a.id))
}

/**
 * Truncate to at most `n` from the TAIL, so the head keeps priority. The field
 * owner orders the array to encode the eviction policy (keep-priority for a full
 * replace vs FIFO for a tap top-up); `capTo` itself is direction-agnostic and
 * always drops the tail.
 */
export function capTo(artists: readonly Artist[], n: number): Artist[] {
	return artists.length <= n ? [...artists] : artists.slice(0, n)
}

/**
 * Cross-fetch dedup memory: remembers artists already shown/retired this session
 * so a later `listSimilar`/`listTop` top-up does not re-surface them. Keyed by
 * normalized name, id, and mbid (a single artist can arrive under a different id
 * across Last.fm calls). Folded out of the retired `BubblePool` into the store.
 */
export class SeenTracker {
	private readonly names = new Set<string>()
	private readonly ids = new Set<string>()
	private readonly mbids = new Set<string>()

	public track(artist: Artist): void {
		const name = artist.name
		const id = artist.id
		const mbid = artist.mbid
		if (name) this.names.add(normalizeName(name))
		if (id) this.ids.add(id)
		if (mbid) this.mbids.add(mbid)
	}

	public trackAll(artists: readonly Artist[]): void {
		for (const a of artists) this.track(a)
	}

	public isSeen(artist: Artist): boolean {
		const name = artist.name
		const id = artist.id
		const mbid = artist.mbid
		if (name && this.names.has(normalizeName(name))) return true
		if (id && this.ids.has(id)) return true
		if (mbid && this.mbids.has(mbid)) return true
		return false
	}

	/** Keep only artists not seen before (does not mutate the tracker). */
	public filterUnseen(artists: readonly Artist[]): Artist[] {
		return artists.filter((a) => !this.isSeen(a))
	}

	public clear(): void {
		this.names.clear()
		this.ids.clear()
		this.mbids.clear()
	}

	/** Reset the memory and re-seed it from the given artists. */
	public resetWith(artists: readonly Artist[]): void {
		this.clear()
		this.trackAll(artists)
	}
}
