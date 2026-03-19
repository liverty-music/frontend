import type { ILogger } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import type { Artist } from '../../entities/artist'
import { BubblePool } from '../../services/bubble-pool'

export interface BubbleArtistClient {
	listTop(country: string, tag: string, limit: number): Promise<Artist[]>
	listSimilar(artistId: string, limit: number): Promise<Artist[]>
}

export class BubbleManager {
	private static readonly SIMILAR_LIMIT_ON_TAP = 30
	private static readonly MAX_SEED_ARTISTS = 5

	public readonly pool = new BubblePool()
	private isLoadingBubbles = false
	private country = 'Japan'

	constructor(
		private readonly client: BubbleArtistClient,
		private readonly logger: ILogger,
		private readonly getFollowedIds: () => ReadonlySet<string>,
	) {}

	public get poolBubbles(): Artist[] {
		return this.pool.availableBubbles
	}

	public async loadInitialArtists(
		followedArtists: Artist[],
		country: string,
		tag: string,
	): Promise<void> {
		this.logger.info('Loading initial artists', { country, tag })
		this.country = country
		this.pool.clearSeenSets()
		this.pool.trackAllSeen(followedArtists)

		let artists: Artist[]

		if (followedArtists.length === 0) {
			artists = await this.client.listTop(country, tag, BubblePool.MAX_BUBBLES)
		} else {
			artists = await this.fetchSeedSimilarArtists(followedArtists)
		}

		artists = this.pool
			.dedup(artists, this.getFollowedIds())
			.slice(0, BubblePool.MAX_BUBBLES)
		this.pool.replace(artists)
		this.pool.trackAllSeen(artists)

		this.logger.info('Loaded initial artists', {
			count: this.pool.availableBubbles.length,
		})
	}

	/**
	 * Fetch similar artists and add them with coordinated eviction.
	 * Returns true if new bubbles were spawned.
	 */
	public async onNeedMoreBubbles(
		artistId: string,
		artistName: string,
		position: { x: number; y: number },
		canvas: DnaOrbCanvas,
	): Promise<boolean> {
		if (this.isLoadingBubbles) return false
		this.isLoadingBubbles = true

		try {
			let newArtists = await this.getSimilarArtists(artistId)
			if (newArtists.length === 0) {
				newArtists = await this.loadReplacementBubbles()
			}

			if (newArtists.length > 0) {
				await this.addBubblesWithEviction(newArtists, position, canvas)
				return true
			}

			this.logger.info('No similar artists found', { artistName })
			return false
		} finally {
			this.isLoadingBubbles = false
		}
	}

	/**
	 * Spawn a bubble and absorb it after search follow.
	 * Defers canvas read until the element is visible via requestAnimationFrame.
	 */
	public spawnAndAbsorbAfterSearch(artist: Artist, canvas: DnaOrbCanvas): void {
		requestAnimationFrame(() => {
			const rect = canvas.canvasRect
			if (rect.width === 0 || rect.height === 0) {
				this.logger.warn('Canvas still hidden after rAF, skipping absorption')
				return
			}
			const spawnX = rect.width / 2
			const spawnY = rect.height * 0.17
			canvas.spawnAndAbsorb(artist, spawnX, spawnY)
		})
	}

	/**
	 * Add bubbles with coordinated pool + physics eviction.
	 */
	private async addBubblesWithEviction(
		newArtists: Artist[],
		position: { x: number; y: number },
		canvas: DnaOrbCanvas,
	): Promise<void> {
		const maxBubbles = this.pool.maxBubbles
		const currentPhysics = canvas.bubbleCount
		const spawnSlots = Math.max(0, maxBubbles - currentPhysics)

		// Evict oldest physics bubbles if we need more room
		if (newArtists.length > spawnSlots) {
			const evictCount = Math.min(
				newArtists.length - spawnSlots,
				currentPhysics,
			)
			if (evictCount > 0) {
				const evicted = this.pool.evictOldest(evictCount)
				const evictedIds = evicted.map((a) => a.id)
				await canvas.fadeOutBubbles(evictedIds)
			}
		}

		// Only spawn up to the cap
		const finalSlots = Math.max(0, maxBubbles - canvas.bubbleCount)
		const toSpawn = newArtists.slice(0, finalSlots)
		if (toSpawn.length > 0) {
			this.pool.add(toSpawn)
			canvas.spawnBubblesAt(toSpawn, position.x, position.y)
		}
	}

	private async getSimilarArtists(artistId: string): Promise<Artist[]> {
		this.logger.info('Getting similar artists', { artistId })

		const rawArtists = await this.client.listSimilar(
			artistId,
			BubbleManager.SIMILAR_LIMIT_ON_TAP,
		)
		const newArtists = this.pool.dedup(rawArtists, this.getFollowedIds())
		this.pool.trackAllSeen(newArtists)

		return newArtists
	}

	private async loadReplacementBubbles(): Promise<Artist[]> {
		this.logger.info('Loading replacement bubbles from top artists')

		this.pool.resetSeenWith(this.pool.availableBubbles)

		const rawArtists = await this.client.listTop(
			this.country,
			'',
			BubblePool.MAX_BUBBLES,
		)
		const fresh = this.pool.dedup(rawArtists, this.getFollowedIds())
		this.pool.trackAllSeen(fresh)

		this.logger.info('Replacement bubbles loaded', { count: fresh.length })
		return fresh
	}

	private async fetchSeedSimilarArtists(
		followedArtists: Artist[],
	): Promise<Artist[]> {
		const seeds = this.pickRandomSeeds(followedArtists)
		const limitPerSeed = Math.floor(BubblePool.MAX_BUBBLES / seeds.length)
		this.logger.info('Fetching seed similar artists', {
			seedCount: seeds.length,
			limitPerSeed,
		})

		const results = await Promise.all(
			seeds.map((seed) =>
				this.client.listSimilar(seed.id, limitPerSeed).catch((err) => {
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
		const max = BubbleManager.MAX_SEED_ARTISTS
		if (followedArtists.length <= max) {
			return [...followedArtists]
		}
		const shuffled = [...followedArtists]
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
		}
		return shuffled.slice(0, max)
	}
}
