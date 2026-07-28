import { DI, resolve } from 'aurelia'
import { IArtistRpcClient } from '../adapter/rpc/client/artist-client'
import type { Artist } from '../entities/artist'
import { CachedResource } from './cache/cached-resource'

export const IArtistStore = DI.createInterface<IArtistStore>(
	'IArtistStore',
	(x) => x.singleton(ArtistStore),
)

export interface IArtistStore extends ArtistStore {}

interface TopInput {
	country: string
	tag: string
	limit: number
}

/**
 * Artist read facade. Caches the global top-artists pool (`listTop`) via the
 * shared SWR primitive so Discovery re-entry reuses the cached field without a
 * refetch, while `listSimilar` and `search` stay uncached pass-throughs
 * (per-artist one-shots / always-fresh search).
 *
 * The cache key MUST include `country + tag + limit`: the discovery flow requests
 * `listTop` with different limits (`MAX_BUBBLES` vs `MAX_BUBBLES / seedCount`), so
 * a `country+tag`-only key would serve the wrong result size.
 */
export class ArtistStore {
	private readonly rpcClient = resolve(IArtistRpcClient)

	private readonly top = new CachedResource<TopInput, Artist[]>(
		({ country, tag, limit }) => `${country}|${tag}|${limit}`,
		({ country, tag, limit }) => this.rpcClient.listTop(country, tag, limit),
	)

	// The most recently requested top-pool input, so PWA resume can refresh the
	// pool the user is actually looking at (any country/tag/limit), not just the
	// base pool.
	private lastTopInput: TopInput | null = null

	// The last successfully generated bubble pool (dedup + top-up applied).
	// Stored here (not on DiscoveryRoute) because DiscoveryRoute is re-instantiated
	// on every navigation — same pattern as ConcertStore.lastDateGroups for Dashboard.
	private lastBubbles: Artist[] | null = null

	/** Global top artists, cached per `country + tag + limit`. */
	public async listTop(
		country: string,
		tag: string,
		limit: number,
	): Promise<Artist[]> {
		this.lastTopInput = { country, tag, limit }
		return this.top.read({ country, tag, limit })
	}

	/**
	 * Force a background refresh of the most recently requested top-artists pool
	 * (route entry / PWA resume). No-op when nothing has been requested yet.
	 */
	public async revalidateLastTop(): Promise<Artist[] | undefined> {
		if (!this.lastTopInput) return undefined
		return this.top.revalidate(this.lastTopInput)
	}

	/**
	 * Synchronous peek at the last successfully generated bubble pool.
	 * Survives DiscoveryRoute re-instantiation because this store is a singleton.
	 */
	public peekBubbles(): Artist[] | null {
		return this.lastBubbles
	}

	/** Persist the latest bubble pool so the next DiscoveryRoute re-entry paints instantly. */
	public setBubbles(artists: Artist[]): void {
		this.lastBubbles = artists
	}

	/** Uncached pass-through: per-artist one-shot (see the audit — ~zero cache hits). */
	public async listSimilar(artistId: string, limit: number): Promise<Artist[]> {
		return this.rpcClient.listSimilar(artistId, limit)
	}

	/** Uncached pass-through: search must stay network-first (TIER 3). */
	public async search(query: string): Promise<Artist[]> {
		return this.rpcClient.search(query)
	}
}
