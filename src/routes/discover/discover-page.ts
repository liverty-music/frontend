import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { batch, ILogger, resolve, watch } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { IToastService } from '../../components/toast-notification/toast-notification'
import type { ArtistBubble } from '../../services/artist-discovery-service'
import { IArtistServiceClient } from '../../services/artist-service-client'
import { BubblePool } from '../../services/bubble-pool'
import { IConcertService } from '../../services/concert-service'
import { ILocalArtistClient } from '../../services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
const GENRE_TAGS = [
	'Rock',
	'Pop',
	'Anime',
	'Jazz',
	'Electronic',
	'Hip-Hop',
	'Metal',
	'R&B',
	'Classical',
	'Indie',
] as const

export class DiscoverPage {
	private readonly artistClient = resolve(IArtistServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly toastService = resolve(IToastService)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly concertService = resolve(IConcertService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoverPage')
	public readonly i18n = resolve(I18N)

	private static readonly TUTORIAL_FOLLOW_TARGET = 3
	private static readonly SIMILAR_LIMIT_ON_TAP = 30
	private static readonly MAX_SEED_ARTISTS = 5

	public dnaOrbCanvas!: DnaOrbCanvas

	private readonly pool = new BubblePool()

	// State exposed to template
	public followedArtists: ArtistBubble[] = []
	public orbIntensity = 0
	public poolFollowedIds: ReadonlySet<string> = new Set()

	public readonly genreTags = GENRE_TAGS
	public activeTag = ''
	public isLoadingTag = false

	public searchQuery = ''
	public isSearchMode = false
	public searchResults: ArtistBubble[] = []
	public isSearching = false
	private isLoadingBubbles = false
	private searchDebounceTimer = 0
	private guidanceDismissTimer = 0
	private abortController = new AbortController()

	public showGuidance = true
	public guidanceHiding = false

	public get poolBubbles(): ArtistBubble[] {
		return this.pool.availableBubbles
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get followedCount(): number {
		if (this.isOnboarding) {
			return this.localClient.followedCount
		}
		return this.followedArtists.length
	}

	public get showCompleteButton(): boolean {
		return (
			this.isOnboarding &&
			this.followedCount >= DiscoverPage.TUTORIAL_FOLLOW_TARGET
		)
	}

	public get guidanceMessage(): string {
		if (!this.isOnboarding) return ''
		const count = this.followedCount
		if (count === 0) return this.i18n.tr('discovery.guidanceStart')
		const remaining = DiscoverPage.TUTORIAL_FOLLOW_TARGET - count
		if (remaining >= 2)
			return this.i18n.tr('discovery.guidanceRemaining', { remaining })
		if (remaining === 1) return this.i18n.tr('discovery.guidanceLast')
		return this.i18n.tr('discovery.guidanceReady')
	}

	public async loading(): Promise<void> {
		this.logger.info('Loading discover page')
		try {
			await this.loadInitialArtists('Japan', '')
		} catch (err) {
			this.logger.error('Failed to load initial artists', err)
			this.toastService.show(this.i18n.tr('discover.loadFailed'), 'error')
		}
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)
	}

	public detaching(): void {
		this.abortController.abort()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		window.clearTimeout(this.searchDebounceTimer)
		window.clearTimeout(this.guidanceDismissTimer)
	}

	private readonly onVisibilityChange = (): void => {
		if (document.hidden) {
			this.dnaOrbCanvas?.pause()
		} else if (!this.isSearchMode) {
			this.dnaOrbCanvas?.resume()
		}
	}

	public async onGenreSelected(tag: string): Promise<void> {
		if (this.isLoadingTag) return

		if (this.activeTag === tag) {
			this.activeTag = ''
			this.isLoadingTag = true
			try {
				await this.reloadWithTag('')
				if (this.abortController.signal.aborted) return
				this.dnaOrbCanvas.reloadBubbles(this.pool.availableBubbles)
			} catch (err) {
				this.logger.error('Failed to clear genre tag', err)
				this.toastService.show(this.i18n.tr('discover.resetFailed'), 'error')
			} finally {
				this.isLoadingTag = false
			}
			return
		}

		this.activeTag = tag
		this.isLoadingTag = true
		this.logger.info('Genre selected', { tag })

		try {
			await this.reloadWithTag(tag.toLowerCase())
			if (this.abortController.signal.aborted) return
			this.dnaOrbCanvas.reloadBubbles(this.pool.availableBubbles)
		} catch (err) {
			this.activeTag = ''
			this.logger.warn('Failed to load genre artists', err)
			this.toastService.show(
				this.i18n.tr('discover.genreLoadFailed', { tag }),
				'error',
			)
		} finally {
			this.isLoadingTag = false
		}
	}

	@watch('searchQuery')
	protected onSearchQueryChanged(newValue: string): void {
		window.clearTimeout(this.searchDebounceTimer)
		const query = newValue.trim()

		if (query.length === 0) {
			this.exitSearchMode()
			return
		}

		this.isSearchMode = true
		this.dnaOrbCanvas?.pause()
		this.searchDebounceTimer = window.setTimeout(() => {
			void this.performSearch(query)
		}, 300)
	}

	public clearSearch(): void {
		this.searchQuery = ''
	}

	private exitSearchMode(): void {
		this.isSearchMode = false
		this.searchResults = []
		this.isSearching = false
		this.dnaOrbCanvas?.resume()
	}

	private async performSearch(query: string): Promise<void> {
		if (query.length < 1) return

		this.isSearching = true
		this.logger.info('Searching artists', { query })

		try {
			const results = await this.artistClient.search(query)
			if (this.abortController.signal.aborted) return
			if (this.searchQuery.trim() !== query) return // stale response
			this.searchResults = results
		} catch (err) {
			this.logger.warn('Search failed', err)
			this.toastService.show(this.i18n.tr('discover.searchFailed'), 'warning')
			this.searchResults = []
		} finally {
			if (this.searchQuery.trim() === query) {
				this.isSearching = false
			}
		}
	}

	public async onArtistSelected(
		event: CustomEvent<{
			artist: ArtistBubble
			position: { x: number; y: number }
		}>,
	): Promise<void> {
		const { artist, position } = event.detail
		if (this.pool.isFollowed(artist.id)) return
		this.logger.info('Artist selected from bubbles', {
			artist: artist.name,
		})

		this.dismissGuidance()

		try {
			await this.followArtist(artist, position)
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})
			this.toastService.show(
				this.i18n.tr('discover.followFailed', { name: artist.name }),
				'error',
			)
			return
		}
		if (this.abortController.signal.aborted) return

		this.checkLiveEvents(artist)
	}

	/**
	 * Handle the need-more-bubbles event from dna-orb-canvas.
	 * Fetches similar artists and spawns them at the tap position.
	 */
	public async onNeedMoreBubbles(
		event: CustomEvent<{
			artistId: string
			artistName: string
			position: { x: number; y: number }
		}>,
	): Promise<void> {
		if (this.isLoadingBubbles) return
		this.isLoadingBubbles = true
		const { artistId, artistName, position } = event.detail

		try {
			let newBubbles = await this.getSimilarArtists(artistId)
			if (newBubbles.length === 0) {
				// Similar artists exhausted — fall back to top-artist pool
				newBubbles = await this.loadReplacementBubbles()
			}

			if (newBubbles.length > 0) {
				const maxBubbles = this.pool.maxBubbles
				const currentPhysics = this.dnaOrbCanvas.bubbleCount
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
						await this.dnaOrbCanvas.fadeOutBubbles(evictedIds)
					}
				}

				// Only spawn up to the cap
				const finalSlots = Math.max(
					0,
					maxBubbles - this.dnaOrbCanvas.bubbleCount,
				)
				const toSpawn = newBubbles.slice(0, finalSlots)
				if (toSpawn.length > 0) {
					this.pool.add(toSpawn)
					this.dnaOrbCanvas.spawnBubblesAt(toSpawn, position.x, position.y)
				}
			} else {
				this.logger.info('No similar artists found', { artistName })
			}
		} catch (err) {
			this.logger.warn('Failed to load similar artists', err)
			this.toastService.show(
				this.i18n.tr('discover.similarArtistsError', {
					name: artistName,
				}),
				'warning',
			)
		} finally {
			this.isLoadingBubbles = false
		}
	}

	public async onFollowFromSearch(artist: ArtistBubble): Promise<void> {
		if (this.pool.isFollowed(artist.id)) return

		this.logger.info('Following artist from search', {
			artist: artist.name,
		})

		try {
			await this.followArtist(artist)
		} catch (err) {
			this.logger.error('Failed to follow artist from search', {
				artist: artist.name,
				error: err,
			})
			this.toastService.show(
				this.i18n.tr('discover.followFailed', { name: artist.name }),
				'error',
			)
			return
		}
		if (this.abortController.signal.aborted) return

		this.checkLiveEvents(artist)
	}

	public isArtistFollowed(artistId: string): boolean {
		return this.pool.isFollowed(artistId)
	}

	private dismissGuidance(): void {
		if (!this.showGuidance || this.guidanceHiding) return
		this.guidanceHiding = true
		this.guidanceDismissTimer = window.setTimeout(() => {
			this.showGuidance = false
			this.guidanceHiding = false
		}, 400)
	}

	public async onViewSchedule(): Promise<void> {
		this.logger.info('Tutorial: advancing to dashboard', {
			followedCount: this.followedCount,
		})
		this.onboarding.setStep(OnboardingStep.DASHBOARD)
		await this.router.load('/dashboard')
	}

	// --- Data orchestration methods (moved from ArtistDiscoveryService) ---

	private async loadInitialArtists(
		country: string,
		tag: string,
	): Promise<void> {
		this.logger.info('Loading initial artists', { country, tag })
		this.pool.clearSeenSets()
		this.markFollowedAsSeen()

		let bubbles: ArtistBubble[]

		if (this.followedArtists.length === 0) {
			bubbles = await this.artistClient.listTop(
				country,
				tag,
				BubblePool.MAX_BUBBLES,
			)
		} else {
			bubbles = await this.fetchSeedSimilarArtists()
		}

		bubbles = this.pool.dedup(bubbles).slice(0, BubblePool.MAX_BUBBLES)
		this.pool.replace(bubbles)
		this.pool.trackAllSeen(bubbles)

		this.logger.info('Loaded initial artists', {
			count: this.pool.availableBubbles.length,
		})
	}

	private async reloadWithTag(tag: string, country = 'Japan'): Promise<void> {
		this.logger.info('Reloading artists with tag', { tag, country })
		this.pool.clearSeenSets()
		this.markFollowedAsSeen()

		const rawBubbles = await this.artistClient.listTop(
			country,
			tag,
			BubblePool.MAX_BUBBLES,
		)
		const bubbles = this.pool.dedup(rawBubbles).slice(0, BubblePool.MAX_BUBBLES)

		this.pool.replace(bubbles)
		this.pool.trackAllSeen(bubbles)

		this.logger.info('Reloaded artists with tag', {
			tag,
			count: this.pool.availableBubbles.length,
		})
	}

	private async getSimilarArtists(artistId: string): Promise<ArtistBubble[]> {
		this.logger.info('Getting similar artists', { artistId })

		const rawBubbles = await this.artistClient.listSimilar(
			artistId,
			DiscoverPage.SIMILAR_LIMIT_ON_TAP,
		)
		const newBubbles = this.pool.dedup(rawBubbles)
		this.pool.trackAllSeen(newBubbles)

		return newBubbles
	}

	private async loadReplacementBubbles(): Promise<ArtistBubble[]> {
		this.logger.info('Loading replacement bubbles from top artists')

		this.pool.resetSeenWith([
			...this.followedArtists,
			...this.pool.availableBubbles,
		])

		const rawBubbles = await this.artistClient.listTop(
			'Japan',
			'',
			BubblePool.MAX_BUBBLES,
		)
		const fresh = this.pool.dedup(rawBubbles)
		this.pool.trackAllSeen(fresh)

		this.logger.info('Replacement bubbles loaded', { count: fresh.length })
		return fresh
	}

	private async followArtist(
		artist: ArtistBubble,
		spawnPosition?: { x: number; y: number },
	): Promise<void> {
		if (this.pool.isFollowed(artist.id)) return
		this.logger.info('Following artist', { artist: artist.name })

		// Optimistic UI update
		this.pool.markFollowed(artist.id)
		this.followedArtists = [...this.followedArtists, artist]
		this.orbIntensity = Math.min(1, this.followedArtists.length / 20)
		this.poolFollowedIds = new Set(this.poolFollowedIds).add(artist.id)

		try {
			await this.artistClient.follow(artist.id, artist.name)
			this.logger.info('Artist followed', {
				followed: this.followedArtists.length,
				orbIntensity: this.orbIntensity,
			})

			// Fire-and-forget: pre-populate concert data in the background
			this.concertService.searchNewConcerts(artist.id).catch((err) => {
				this.logger.warn('Background concert search failed', {
					artistId: artist.id,
					error: err,
				})
			})
		} catch (err) {
			this.logger.error('Failed to follow artist', {
				artist: artist.name,
				error: err,
			})

			// Rollback optimistic update
			batch(() => {
				this.pool.unmarkFollowed(artist.id)
				this.pool.add([artist])
				this.followedArtists = this.followedArtists.filter(
					(b) => b.id !== artist.id,
				)
				this.orbIntensity = Math.min(1, this.followedArtists.length / 20)
				const ids = new Set(this.poolFollowedIds)
				ids.delete(artist.id)
				this.poolFollowedIds = ids
			})

			// Re-render the bubble on canvas if it was removed during interaction
			if (spawnPosition) {
				this.dnaOrbCanvas.spawnBubblesAt(
					[artist],
					spawnPosition.x,
					spawnPosition.y,
				)
			}

			this.toastService.show(`Failed to follow ${artist.name}`)
			throw err
		}
	}

	private checkLiveEvents(artist: ArtistBubble): void {
		this.concertService
			.listConcerts(artist.id)
			.then((concerts) => {
				if (this.abortController.signal.aborted) return
				if (concerts.length > 0) {
					this.toastService.show(
						this.i18n.tr('discover.hasUpcomingEvents', {
							name: artist.name,
						}),
					)
				}
			})
			.catch((err) => {
				this.logger.warn('Failed to check live events', err)
			})
	}

	private markFollowedAsSeen(): void {
		this.pool.trackAllSeen(this.followedArtists)
	}

	private async fetchSeedSimilarArtists(): Promise<ArtistBubble[]> {
		const seeds = this.pickRandomSeeds()
		const limitPerSeed = Math.floor(BubblePool.MAX_BUBBLES / seeds.length)
		this.logger.info('Fetching seed similar artists', {
			seedCount: seeds.length,
			limitPerSeed,
		})

		const results = await Promise.all(
			seeds.map((seed) =>
				this.artistClient.listSimilar(seed.id, limitPerSeed).catch((err) => {
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
		const max = DiscoverPage.MAX_SEED_ARTISTS
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
}
