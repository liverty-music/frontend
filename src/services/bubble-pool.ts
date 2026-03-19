import type { Artist } from '../entities/artist'

/**
 * Manages the available bubble pool for the discovery page.
 * Handles deduplication (by name, id, mbid), eviction, and pool size limits.
 *
 * This is a plain class (not DI-registered) -- its lifetime matches
 * the owning component (DiscoveryRoute), not the app lifetime.
 */
export class BubblePool {
	public static readonly MAX_BUBBLES = 50

	public availableBubbles: Artist[] = []

	private readonly seenArtistNames = new Set<string>()
	private readonly seenArtistIds = new Set<string>()
	private readonly seenArtistMbids = new Set<string>()
	public get maxBubbles(): number {
		return BubblePool.MAX_BUBBLES
	}

	/**
	 * Add bubbles to the pool, evicting oldest first if it would exceed MAX_BUBBLES.
	 * Returns the list of evicted bubble IDs (for physics fade-out).
	 */
	public add(newBubbles: Artist[]): string[] {
		const max = BubblePool.MAX_BUBBLES
		const total = this.availableBubbles.length + newBubbles.length
		const overflow = total - max
		let evictedIds: string[] = []

		if (overflow > 0) {
			evictedIds = this.availableBubbles.slice(0, overflow).map((a) => a.id)
			this.availableBubbles = [
				...this.availableBubbles.slice(overflow),
				...newBubbles,
			]
		} else {
			this.availableBubbles = [...this.availableBubbles, ...newBubbles]
		}

		return evictedIds
	}

	/**
	 * Remove an artist from the available pool (e.g. after being followed).
	 */
	public remove(artistId: string): void {
		this.availableBubbles = this.availableBubbles.filter(
			(a) => a.id !== artistId,
		)
	}

	/**
	 * Evict the oldest N bubbles from the available pool.
	 * Returns the evicted bubbles (for physics fade-out).
	 */
	public evictOldest(count: number): Artist[] {
		if (count <= 0) return []
		const evicted = this.availableBubbles.slice(0, count)
		this.availableBubbles = this.availableBubbles.slice(count)
		return evicted
	}

	/**
	 * Replace the entire pool with new bubbles.
	 */
	public replace(bubbles: Artist[]): void {
		this.availableBubbles = bubbles
	}

	/**
	 * Reset the pool and all tracking sets.
	 */
	public reset(): void {
		this.availableBubbles = []
		this.clearSeenSets()
	}

	/**
	 * Deduplicate bubbles: remove seen artists and already-followed artists.
	 * Follow state is provided externally by the caller.
	 */
	public dedup(artists: Artist[], followedIds: ReadonlySet<string>): Artist[] {
		return artists.filter((a) => !this.isSeen(a) && !followedIds.has(a.id))
	}

	/**
	 * Track an artist as seen (prevents future duplicates).
	 */
	public trackSeen(artist: Artist): void {
		const name = artist.name
		const id = artist.id
		const mbid = artist.mbid
		if (name) this.seenArtistNames.add(this.normalizeName(name))
		if (id) this.seenArtistIds.add(id)
		if (mbid) this.seenArtistMbids.add(mbid)
	}

	/**
	 * Track multiple artists as seen.
	 */
	public trackAllSeen(artists: Artist[]): void {
		for (const a of artists) {
			this.trackSeen(a)
		}
	}

	/**
	 * Clear seen sets and re-seed from provided artists.
	 */
	public resetSeenWith(keepSeen: Artist[]): void {
		this.clearSeenSets()
		this.trackAllSeen(keepSeen)
	}

	public clearSeenSets(): void {
		this.seenArtistNames.clear()
		this.seenArtistIds.clear()
		this.seenArtistMbids.clear()
	}

	private isSeen(artist: Artist): boolean {
		const name = artist.name
		const id = artist.id
		const mbid = artist.mbid
		if (name && this.seenArtistNames.has(this.normalizeName(name))) return true
		if (id && this.seenArtistIds.has(id)) return true
		if (mbid && this.seenArtistMbids.has(mbid)) return true
		return false
	}

	private normalizeName(name: string): string {
		return name.trim().replace(/\s+/g, ' ').toLowerCase()
	}
}
