import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { IEventAggregator, ILogger, resolve, watch } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { Snack } from '../../components/snack-bar/snack'
import {
	type ArtistBubble,
	IArtistServiceClient,
} from '../../services/artist-service-client'
import { IConcertService } from '../../services/concert-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { resolveStore } from '../../state/store-interface'
import { BubbleManager } from './bubble-manager'
import { ConcertSearchTracker } from './concert-search-tracker'
import { FollowOrchestrator } from './follow-orchestrator'
import { GenreFilterController } from './genre-filter-controller'
import { SearchController } from './search-controller'

const TUTORIAL_FOLLOW_TARGET = 3

export class DiscoveryRoute {
	private readonly artistClient = resolve(IArtistServiceClient)
	private readonly followClient = resolve(IFollowServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly ea = resolve(IEventAggregator)
	private readonly store = resolveStore()
	private readonly concertService = resolve(IConcertService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoveryRoute')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas
	public onboardingGuide!: HTMLElement

	private abortController = new AbortController()

	// Controllers — order matters: bubbles must be initialized before genre/follow
	public readonly bubbles = new BubbleManager(
		this.artistClient,
		resolve(ILogger).scopeTo('BubbleManager'),
		() => this.follow.followedIds,
	)

	public readonly search = new SearchController(
		this.artistClient,
		{
			onEnterSearchMode: () => this.dnaOrbCanvas?.pause(),
			onExitSearchMode: () => this.dnaOrbCanvas?.resume(),
			onError: (key) =>
				this.ea.publish(new Snack(this.i18n.tr(key), 'warning')),
		},
		resolve(ILogger).scopeTo('SearchController'),
	)

	public readonly genre = new GenreFilterController(
		this.artistClient,
		this.bubbles.pool,
		() => this.follow.followedArtists,
		{
			onBubblesReloaded: (bubbles) => this.dnaOrbCanvas.reloadBubbles(bubbles),
			onError: (key, params) =>
				this.ea.publish(new Snack(this.i18n.tr(key, params), 'error')),
		},
		resolve(ILogger).scopeTo('GenreFilterController'),
		() => this.abortController.signal,
	)

	public readonly follow = new FollowOrchestrator(
		this.followClient,
		this.concertService,
		this.bubbles.pool,
		{
			onFollowed: (artist) => {
				this.concertTracker.searchConcertsWithTimeout(artist.id)
			},
			onRollback: () => {},
			onHasUpcomingEvents: (name) =>
				this.ea.publish(
					new Snack(this.i18n.tr('discovery.hasUpcomingEvents', { name })),
				),
			onError: (key, params) =>
				this.ea.publish(new Snack(this.i18n.tr(key, params), 'error')),
			respawnBubble: (artist, pos) =>
				this.dnaOrbCanvas.spawnBubblesAt([artist], pos.x, pos.y),
		},
		resolve(ILogger).scopeTo('FollowOrchestrator'),
		() => this.abortController.signal,
	)

	public readonly concertTracker = new ConcertSearchTracker(
		this.concertService,
		{
			onAllSearchesComplete: () => {
				// Coach mark reactivity is handled by @watch
			},
		},
		resolve(ILogger).scopeTo('ConcertSearchTracker'),
		() => this.abortController.signal,
		() => this.followedCount,
		TUTORIAL_FOLLOW_TARGET,
	)

	public get poolBubbles(): ArtistBubble[] {
		return this.bubbles.poolBubbles
	}

	public get followedIds(): ReadonlySet<string> {
		return this.follow.followedIds
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get followedCount(): number {
		if (this.isOnboarding) {
			return this.store.getState().guest.follows.length
		}
		return this.follow.followedCount
	}

	public get showDashboardCoachMark(): boolean {
		return (
			this.isOnboarding &&
			this.followedCount >= TUTORIAL_FOLLOW_TARGET &&
			this.concertTracker.completedSearchCount >= this.followedCount &&
			this.concertTracker.concertGroupCount > 0
		)
	}

	public get srStatusText(): string {
		const parts: string[] = []
		if (this.search.isSearchMode) {
			parts.push(
				this.i18n.tr('discovery.srSearchResults', {
					count: this.search.searchResults.length,
				}),
			)
		} else {
			parts.push(
				this.i18n.tr('discovery.srArtistsAvailable', {
					count: this.dnaOrbCanvas?.bubbleCount ?? 0,
				}),
			)
		}
		parts.push(
			this.i18n.tr('discovery.srFollowed', { count: this.followedCount }),
		)
		return parts.join('. ')
	}

	@watch('showDashboardCoachMark')
	protected onShowDashboardCoachMarkChanged(show: boolean): void {
		if (show) {
			this.onboarding.activateSpotlight(
				'[data-nav="home"]',
				this.i18n.tr('discovery.coachMark.viewTimetable'),
				() => this.onCoachMarkTap(),
				'50%',
			)
		}
	}

	public async loading(): Promise<void> {
		this.logger.info('Loading discovery page')
		try {
			await this.bubbles.loadInitialArtists(
				this.follow.followedArtists,
				'Japan',
				'',
			)
		} catch (err) {
			this.logger.error('Failed to load initial artists', err)
			this.ea.publish(new Snack(this.i18n.tr('discovery.loadFailed'), 'error'))
		}

		if (this.isOnboarding) {
			const preSeeded = this.store.getState().guest.follows
			this.concertTracker.syncPreSeeded(preSeeded)
		}
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)

		if (this.isOnboarding && this.onboardingGuide) {
			this.onboardingGuide.showPopover()
		}
	}

	public detaching(): void {
		this.abortController.abort()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.search.dispose()
		this.concertTracker.dispose()
	}

	private readonly onVisibilityChange = (): void => {
		if (document.hidden) {
			this.dnaOrbCanvas?.pause()
		} else if (!this.search.isSearchMode) {
			this.dnaOrbCanvas?.resume()
		}
	}

	// --- Template event handlers ---

	@watch('search.searchQuery')
	protected onSearchQueryChanged(newValue: string): void {
		this.search.onQueryChanged(newValue)
	}

	public clearSearch(): void {
		this.search.clearSearch()
	}

	public async onGenreSelected(tag: string): Promise<void> {
		await this.genre.onGenreSelected(tag)
	}

	public async onArtistSelected(
		event: CustomEvent<{
			artist: ArtistBubble
			position: { x: number; y: number }
		}>,
	): Promise<void> {
		const { artist, position } = event.detail
		if (this.followedIds.has(artist.id)) return
		this.logger.info('Artist selected from bubbles', {
			artist: artist.name,
		})

		try {
			await this.follow.followArtist(artist, position)
		} catch {
			return
		}
		if (this.abortController.signal.aborted) return

		this.follow.checkLiveEvents(artist)
	}

	public async onNeedMoreBubbles(
		event: CustomEvent<{
			artistId: string
			artistName: string
			position: { x: number; y: number }
		}>,
	): Promise<void> {
		const { artistId, artistName, position } = event.detail
		try {
			const spawned = await this.bubbles.onNeedMoreBubbles(
				artistId,
				artistName,
				position,
				this.dnaOrbCanvas,
			)
			if (!spawned) {
				this.ea.publish(
					new Snack(
						this.i18n.tr('discovery.similarArtistsUnavailable', {
							name: artistName,
						}),
						'info',
					),
				)
			}
		} catch (err) {
			this.logger.warn('Failed to load similar artists', err)
			this.ea.publish(
				new Snack(
					this.i18n.tr('discovery.similarArtistsError', {
						name: artistName,
					}),
					'warning',
				),
			)
		}
	}

	public async onFollowFromSearch(artist: ArtistBubble): Promise<void> {
		if (this.followedIds.has(artist.id)) return

		this.logger.info('Following artist from search', {
			artist: artist.name,
		})

		try {
			await this.follow.followArtist(artist)
		} catch {
			return
		}
		if (this.abortController.signal.aborted) return

		// Transition to bubble view and play absorption animation
		this.search.clearSearch()
		this.search.exitSearchMode()

		this.bubbles.spawnAndAbsorbAfterSearch(artist, this.dnaOrbCanvas)

		this.follow.checkLiveEvents(artist)
	}

	public onCoachMarkTap(): void {
		this.logger.info('Onboarding: coach mark tapped, advancing to dashboard', {
			followedCount: this.followedCount,
		})
		this.onboarding.deactivateSpotlight()
		this.onboarding.setStep(OnboardingStep.DASHBOARD)
		void this.router.load('/dashboard')
	}
}
