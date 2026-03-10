import type { ArtistBubble } from './artist-service-client'

/**
 * Manages the available bubble pool for the discover page.
 * Handles deduplication (by name, id, mbid), eviction, and pool size limits.
 *
 * This is a plain class (not DI-registered) — its lifetime matches
 * the owning component (DiscoverPage), not the app lifetime.
 */
export class BubblePool {
	public static readonly MAX_BUBBLES = 50

	public availableBubbles: ArtistBubble[] = []

	private readonly seenArtistNames = new Set<string>()
	private readonly seenArtistIds = new Set<string>()
	private readonly seenArtistMbids = new Set<string>()
	private readonly followedIds = new Set<string>()

	public get maxBubbles(): number {
		return BubblePool.MAX_BUBBLES
	}

	/**
	 * Add bubbles to the pool, evicting oldest first if it would exceed MAX_BUBBLES.
	 * Returns the list of evicted bubble IDs (for physics fade-out).
	 */
	public add(newBubbles: ArtistBubble[]): string[] {
		const max = BubblePool.MAX_BUBBLES
		const total = this.availableBubbles.length + newBubbles.length
		const overflow = total - max
		let evictedIds: string[] = []

		if (overflow > 0) {
			evictedIds = this.availableBubbles.slice(0, overflow).map((b) => b.id)
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
			(b) => b.id !== artistId,
		)
	}

	/**
	 * Evict the oldest N bubbles from the available pool.
	 * Returns the evicted bubbles (for physics fade-out).
	 */
	public evictOldest(count: number): ArtistBubble[] {
		if (count <= 0) return []
		return this.availableBubbles.splice(0, count)
	}

	/**
	 * Replace the entire pool with new bubbles.
	 */
	public replace(bubbles: ArtistBubble[]): void {
		this.availableBubbles = bubbles
	}

	/**
	 * Reset the pool and all tracking sets.
	 */
	public reset(): void {
		this.availableBubbles = []
		this.clearSeenSets()
		this.followedIds.clear()
	}

	/**
	 * Mark an artist as followed. Removes from available pool.
	 */
	public markFollowed(artistId: string): void {
		this.followedIds.add(artistId)
		this.remove(artistId)
	}

	/**
	 * Unmark an artist as followed (for rollback).
	 */
	public unmarkFollowed(artistId: string): void {
		this.followedIds.delete(artistId)
	}

	public isFollowed(artistId: string): boolean {
		return this.followedIds.has(artistId)
	}

	/**
	 * Deduplicate bubbles: remove seen artists and already-followed artists.
	 */
	public dedup(bubbles: ArtistBubble[]): ArtistBubble[] {
		return bubbles.filter((b) => !this.isSeen(b) && !this.isFollowed(b.id))
	}

	/**
	 * Track a bubble as seen (prevents future duplicates).
	 */
	public trackSeen(bubble: ArtistBubble): void {
		this.seenArtistNames.add(this.normalizeName(bubble.name))
		if (bubble.id) this.seenArtistIds.add(bubble.id)
		if (bubble.mbid) this.seenArtistMbids.add(bubble.mbid)
	}

	/**
	 * Track multiple bubbles as seen.
	 */
	public trackAllSeen(bubbles: ArtistBubble[]): void {
		for (const b of bubbles) {
			this.trackSeen(b)
		}
	}

	/**
	 * Clear seen sets and re-seed from provided bubbles.
	 */
	public resetSeenWith(keepSeen: ArtistBubble[]): void {
		this.clearSeenSets()
		this.trackAllSeen(keepSeen)
	}

	public clearSeenSets(): void {
		this.seenArtistNames.clear()
		this.seenArtistIds.clear()
		this.seenArtistMbids.clear()
	}

	private isSeen(bubble: ArtistBubble): boolean {
		if (this.seenArtistNames.has(this.normalizeName(bubble.name))) return true
		if (bubble.id && this.seenArtistIds.has(bubble.id)) return true
		if (bubble.mbid && this.seenArtistMbids.has(bubble.mbid)) return true
		return false
	}

	private normalizeName(name: string): string {
		return name.trim().replace(/\s+/g, ' ').toLowerCase()
	}
}
