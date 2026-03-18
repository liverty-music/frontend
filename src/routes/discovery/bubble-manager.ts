import type { ILogger } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import type { ArtistBubble } from '../../services/artist-service-client'
import { BubblePool } from '../../services/bubble-pool'

export interface BubbleArtistClient {
	listTop(country: string, tag: string, limit: number): Promise<ArtistBubble[]>
	listSimilar(artistId: string, limit: number): Promise<ArtistBubble[]>
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

	public get poolBubbles(): ArtistBubble[] {
		return this.pool.availableBubbles
	}

	public async loadInitialArtists(
		followedArtists: ArtistBubble[],
		country: string,
		tag: string,
	): Promise<void> {
		this.logger.info('Loading initial artists', { country, tag })
		this.country = country
		this.pool.clearSeenSets()
		this.pool.trackAllSeen(followedArtists)

		let bubbles: ArtistBubble[]

		if (followedArtists.length === 0) {
			bubbles = await this.client.listTop(country, tag, BubblePool.MAX_BUBBLES)
		} else {
			bubbles = await this.fetchSeedSimilarArtists(followedArtists)
		}

		bubbles = this.pool
			.dedup(bubbles, this.getFollowedIds())
			.slice(0, BubblePool.MAX_BUBBLES)
		this.pool.replace(bubbles)
		this.pool.trackAllSeen(bubbles)

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
			let newBubbles = await this.getSimilarArtists(artistId)
			if (newBubbles.length === 0) {
				newBubbles = await this.loadReplacementBubbles()
			}

			if (newBubbles.length > 0) {
				await this.addBubblesWithEviction(newBubbles, position, canvas)
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
	public spawnAndAbsorbAfterSearch(
		artist: ArtistBubble,
		canvas: DnaOrbCanvas,
	): void {
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
		newBubbles: ArtistBubble[],
		position: { x: number; y: number },
		canvas: DnaOrbCanvas,
	): Promise<void> {
		const maxBubbles = this.pool.maxBubbles
		const currentPhysics = canvas.bubbleCount
		const spawnSlots = Math.max(0, maxBubbles - currentPhysics)

		// Evict oldest physics bubbles if we need more room
		if (newBubbles.length > spawnSlots) {
			const evictCount = Math.min(
				newBubbles.length - spawnSlots,
				currentPhysics,
			)
			if (evictCount > 0) {
				const evicted = this.pool.evictOldest(evictCount)
				const evictedIds = evicted.map((b) => b.id)
				await canvas.fadeOutBubbles(evictedIds)
			}
		}

		// Only spawn up to the cap
		const finalSlots = Math.max(0, maxBubbles - canvas.bubbleCount)
		const toSpawn = newBubbles.slice(0, finalSlots)
		if (toSpawn.length > 0) {
			this.pool.add(toSpawn)
			canvas.spawnBubblesAt(toSpawn, position.x, position.y)
		}
	}

	private async getSimilarArtists(artistId: string): Promise<ArtistBubble[]> {
		this.logger.info('Getting similar artists', { artistId })

		const rawBubbles = await this.client.listSimilar(
			artistId,
			BubbleManager.SIMILAR_LIMIT_ON_TAP,
		)
		const newBubbles = this.pool.dedup(rawBubbles, this.getFollowedIds())
		this.pool.trackAllSeen(newBubbles)

		return newBubbles
	}

	private async loadReplacementBubbles(): Promise<ArtistBubble[]> {
		this.logger.info('Loading replacement bubbles from top artists')

		this.pool.resetSeenWith(this.pool.availableBubbles)

		const rawBubbles = await this.client.listTop(
			this.country,
			'',
			BubblePool.MAX_BUBBLES,
		)
		const fresh = this.pool.dedup(rawBubbles, this.getFollowedIds())
		this.pool.trackAllSeen(fresh)

		this.logger.info('Replacement bubbles loaded', { count: fresh.length })
		return fresh
	}

	private async fetchSeedSimilarArtists(
		followedArtists: ArtistBubble[],
	): Promise<ArtistBubble[]> {
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
					return [] as ArtistBubble[]
				}),
			),
		)

		return results.flat()
	}

	private pickRandomSeeds(followedArtists: ArtistBubble[]): ArtistBubble[] {
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
