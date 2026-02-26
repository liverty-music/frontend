import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import type { PromiseClient } from '@connectrpc/connect'
import { createPromiseClient } from '@connectrpc/connect'
import { batch, DI, ILogger, resolve } from 'aurelia'
import { IToastService } from '../components/toast-notification/toast-notification'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export interface ArtistBubble {
	id: string
	name: string
	mbid: string
	imageUrl: string
	x: number
	y: number
	radius: number
}

export const IArtistDiscoveryService =
	DI.createInterface<IArtistDiscoveryService>('IArtistDiscoveryService', (x) =>
		x.singleton(ArtistDiscoveryService),
	)

export interface IArtistDiscoveryService extends ArtistDiscoveryService {}

export class ArtistDiscoveryService {
	private readonly logger = resolve(ILogger).scopeTo('ArtistDiscoveryService')
	private readonly toast = resolve(IToastService)
	private readonly artistClient: PromiseClient<typeof ArtistService>

	constructor() {
		const authService = resolve(IAuthService)
		this.artistClient = createPromiseClient(
			ArtistService,
			createTransport(authService, resolve(ILogger).scopeTo('Transport')),
		)
	}

	public static readonly MAX_BUBBLES = 50
	private static readonly SIMILAR_LIMIT_ON_TAP = 30
	private static readonly MAX_SEED_ARTISTS = 5

	public availableBubbles: ArtistBubble[] = []
	public followedArtists: ArtistBubble[] = []
	public orbIntensity = 0

	private readonly seenArtistNames = new Set<string>()
	private readonly seenArtistIds = new Set<string>()
	private readonly seenArtistMbids = new Set<string>()
	private readonly followedIds = new Set<string>()

	/**
	 * Step 1: Load the initial bubble pool.
	 *
	 * 1-a. If the user follows nobody, fetch top artists via ListTop(limit=50).
	 * 1-b. If the user follows artists, randomly pick up to 5 seed artists and
	 *      fetch ListSimilar for each, splitting the limit evenly to fill MAX_BUBBLES.
	 *
	 * Step 2: Deduplicate and exclude already-followed artists.
	 */
	public async loadInitialArtists(country = 'Japan', tag = ''): Promise<void> {
		this.logger.info('Loading initial artists', { country, tag })
		this.clearSeenSets()
		this.markFollowedAsSeen()

		let bubbles: ArtistBubble[]

		if (this.followedArtists.length === 0) {
			// Step 1-a: No followed artists — fetch top chart
			const resp = await this.artistClient.listTop({
				country,
				tag,
				limit: ArtistDiscoveryService.MAX_BUBBLES,
			})
			bubbles = resp.artists.map((a) => this.toBubble(a))
		} else {
			// Step 1-b: Seed from followed artists
			bubbles = await this.fetchSeedSimilarArtists()
		}

		// Step 2: Deduplicate and exclude followed
		bubbles = this.dedup(bubbles).slice(0, ArtistDiscoveryService.MAX_BUBBLES)

		this.availableBubbles = bubbles
		for (const b of bubbles) {
			this.trackSeen(b)
		}
		this.logger.info('Loaded initial artists', {
			count: this.availableBubbles.length,
		})
	}

	public async reloadWithTag(tag: string, country = 'Japan'): Promise<void> {
		this.logger.info('Reloading artists with tag', { tag, country })
		this.clearSeenSets()
		this.markFollowedAsSeen()

		const resp = await this.artistClient.listTop({
			country,
			tag,
			limit: ArtistDiscoveryService.MAX_BUBBLES,
		})
		const bubbles = this.dedup(
			resp.artists.map((a) => this.toBubble(a)),
		).slice(0, ArtistDiscoveryService.MAX_BUBBLES)

		this.availableBubbles = bubbles
		for (const b of bubbles) {
			this.trackSeen(b)
		}
		this.logger.info('Reloaded artists with tag', {
			tag,
			count: this.availableBubbles.length,
		})
	}

	public async searchArtists(query: string): Promise<ArtistBubble[]> {
		this.logger.info('Searching artists', { query })
		const resp = await this.artistClient.search({ query })
		return resp.artists.map((a) => this.toBubble(a))
	}

	public isFollowed(artistId: string): boolean {
		return this.followedIds.has(artistId)
	}

	/**
	 * Update UI state to reflect that an artist has been followed.
	 * Does NOT persist to any backend — call ArtistServiceClient.follow() for that.
	 */
	public markFollowed(artist: ArtistBubble): void {
		if (this.isFollowed(artist.id)) return
		this.availableBubbles = this.availableBubbles.filter(
			(b) => b.id !== artist.id,
		)
		this.followedIds.add(artist.id)
		this.followedArtists = [...this.followedArtists, artist]
		this.orbIntensity = Math.min(1, this.followedArtists.length / 20)
	}

	public async followArtist(artist: ArtistBubble): Promise<void> {
		if (this.isFollowed(artist.id)) return
		this.logger.info('Following artist', { artist: artist.name })

		// Optimistic UI update
		this.availableBubbles = this.availableBubbles.filter(
			(b) => b.id !== artist.id,
		)
		this.followedIds.add(artist.id)
		this.followedArtists = [...this.followedArtists, artist]
		this.orbIntensity = Math.min(1, this.followedArtists.length / 20)

		// Persist follow to backend with 1 retry
		const req = { artistId: new ArtistId({ value: artist.id }) }
		try {
			await this.artistClient.follow(req)
			this.logger.info('Artist followed', {
				followed: this.followedArtists.length,
				orbIntensity: this.orbIntensity,
			})
		} catch (firstErr) {
			this.logger.warn('Follow failed, retrying', {
				artist: artist.name,
				error: firstErr,
			})
			try {
				await this.artistClient.follow(req)
				this.logger.info('Artist followed on retry', {
					artist: artist.name,
				})
			} catch (retryErr) {
				this.logger.error('Failed to follow artist after retry', retryErr)

				// Rollback optimistic update atomically to avoid intermediate UI flicker
				batch(() => {
					this.followedArtists = this.followedArtists.filter(
						(b) => b.id !== artist.id,
					)
					this.followedIds.delete(artist.id)
					this.availableBubbles = [...this.availableBubbles, artist]
					this.orbIntensity = Math.min(1, this.followedArtists.length / 20)
				})

				this.toast.show(`Failed to follow ${artist.name}`)
				throw retryErr
			}
		}
	}

	/**
	 * Step 4: Fetch similar artists for a tapped artist.
	 *
	 * Returns new (unseen, unfollowed) bubbles WITHOUT modifying the pool.
	 * The caller is responsible for eviction and insertion.
	 */
	public async getSimilarArtists(
		artistName: string,
		artistId: string,
		limit = ArtistDiscoveryService.SIMILAR_LIMIT_ON_TAP,
	): Promise<ArtistBubble[]> {
		this.logger.info('Getting similar artists', { artistName, artistId, limit })

		const resp = await this.artistClient.listSimilar({
			artistId: new ArtistId({ value: artistId }),
			limit,
		})

		const newBubbles = this.dedup(
			resp.artists.map((a) => this.toBubble(a)),
		)

		for (const b of newBubbles) {
			this.trackSeen(b)
		}

		return newBubbles
	}

	/**
	 * Add bubbles to the pool, evicting oldest first if it would exceed MAX_BUBBLES.
	 * Returns the list of evicted bubble IDs (for physics fade-out).
	 */
	public addToPool(newBubbles: ArtistBubble[]): string[] {
		const max = ArtistDiscoveryService.MAX_BUBBLES
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

	public async checkLiveEvents(artistName: string): Promise<boolean> {
		this.logger.info('Checking live events', { artistName })
		// TODO: Call backend ConcertService.List via Connect-RPC when TS clients are generated
		// For now, simulate — return true for ~30% of artists to demonstrate the toast
		const hash = Array.from(artistName).reduce(
			(acc, c) => acc + c.charCodeAt(0),
			0,
		)
		return hash % 3 === 0
	}

	public async listFollowedFromBackend(
		signal?: AbortSignal,
	): Promise<ArtistBubble[]> {
		this.logger.info('Fetching followed artists from backend')
		try {
			const resp = await this.artistClient.listFollowed({}, { signal })
			const bubbles = resp.artists.flatMap((fa) =>
				fa.artist ? [this.toBubble(fa.artist)] : [],
			)
			this.logger.info('Followed artists fetched', {
				count: bubbles.length,
			})
			return bubbles
		} catch (err) {
			this.logger.error('Failed to fetch followed artists', err)
			throw err
		}
	}

	private normalizeName(name: string): string {
		return name.trim().replace(/\s+/g, ' ').toLowerCase()
	}

	private isSeen(bubble: ArtistBubble): boolean {
		if (this.seenArtistNames.has(this.normalizeName(bubble.name))) return true
		if (bubble.id && this.seenArtistIds.has(bubble.id)) return true
		if (bubble.mbid && this.seenArtistMbids.has(bubble.mbid)) return true
		return false
	}

	private trackSeen(bubble: ArtistBubble): void {
		this.seenArtistNames.add(this.normalizeName(bubble.name))
		if (bubble.id) this.seenArtistIds.add(bubble.id)
		if (bubble.mbid) this.seenArtistMbids.add(bubble.mbid)
	}

	private markFollowedAsSeen(): void {
		for (const f of this.followedArtists) {
			this.trackSeen(f)
		}
	}

	/**
	 * Step 1-b helper: pick up to MAX_SEED_ARTISTS random followed artists
	 * and fetch similar artists for each, splitting the limit evenly.
	 */
	private async fetchSeedSimilarArtists(): Promise<ArtistBubble[]> {
		const seeds = this.pickRandomSeeds()
		const limitPerSeed = Math.floor(
			ArtistDiscoveryService.MAX_BUBBLES / seeds.length,
		)
		this.logger.info('Fetching seed similar artists', {
			seedCount: seeds.length,
			limitPerSeed,
		})

		const results = await Promise.all(
			seeds.map((seed) =>
				this.artistClient
					.listSimilar({
						artistId: new ArtistId({ value: seed.id }),
						limit: limitPerSeed,
					})
					.then((resp) => resp.artists.map((a) => this.toBubble(a)))
					.catch((err) => {
						this.logger.warn('Seed similar fetch failed', {
							seed: seed.name,
							error: err,
						})
						return [] as ArtistBubble[]
					}),
			),
		)

		return results.flat()
	}

	private pickRandomSeeds(): ArtistBubble[] {
		const max = ArtistDiscoveryService.MAX_SEED_ARTISTS
		if (this.followedArtists.length <= max) {
			return [...this.followedArtists]
		}
		const shuffled = [...this.followedArtists]
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
		}
		return shuffled.slice(0, max)
	}

	/**
	 * Deduplicate bubbles: remove seen artists and already-followed artists.
	 */
	private dedup(bubbles: ArtistBubble[]): ArtistBubble[] {
		return bubbles.filter((b) => !this.isSeen(b) && !this.isFollowed(b.id))
	}

	private clearSeenSets(): void {
		this.seenArtistNames.clear()
		this.seenArtistIds.clear()
		this.seenArtistMbids.clear()
	}

	private toBubble(artist: {
		id?: { value: string }
		name?: { value: string }
		mbid?: { value: string }
	}): ArtistBubble {
		const id = artist.id?.value ?? ''
		const name = artist.name?.value ?? ''
		const mbid = artist.mbid?.value ?? ''
		return {
			id: id || mbid || crypto.randomUUID(),
			name,
			mbid,
			imageUrl: '',
			x: 0,
			y: 0,
			radius: 30 + Math.random() * 15,
		}
	}
}
