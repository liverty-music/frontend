import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { IEventAggregator, ILogger, resolve, watch } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { Snack } from '../../components/snack-bar/snack'
import type { Artist } from '../../entities/artist'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import { IArtistStore } from '../../services/artist-store'
import { IConcertStore } from '../../services/concert-store'
import { IFollowServiceClient } from '../../services/follow-service-client'
import {
	DASHBOARD_CONCERT_TARGET,
	DASHBOARD_FOLLOW_TARGET,
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { detectCountryFromTimezone } from '../../util/detect-country'
import { BubbleManager } from './bubble-manager'
import { GenreFilterController } from './genre-filter-controller'
import { SearchController } from './search-controller'

export class DiscoveryRoute {
	private readonly artistClient = resolve(IArtistStore)
	private readonly followService = resolve(IFollowServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly ea = resolve(IEventAggregator)
	private readonly concertService = resolve(IConcertStore)
	private readonly analytics = resolve(IAnalyticsService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoveryRoute')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas

	private abortController = new AbortController()
	private dashboardCoachMarkShown = false

	// Controllers
	public readonly bubbles = new BubbleManager(
		this.artistClient,
		resolve(ILogger).scopeTo('BubbleManager'),
		() => this.followService.followedIds,
	)

	public readonly search = new SearchController(
		this.artistClient,
		{
			onEnterSearchMode: () => this.dnaOrbCanvas?.pause(),
			onExitSearchMode: () => this.dnaOrbCanvas?.resume(),
			onError: (key) =>
				this.ea.publish(new Snack(this.i18n.tr(key), 'warning')),
			onSearchCompleted: ({ queryLength, resultCount }) => {
				this.analytics.capture(Events.ArtistSearch, {
					query_length: queryLength,
					result_count: resultCount,
				})
			},
		},
		resolve(ILogger).scopeTo('SearchController'),
	)

	public readonly genre = new GenreFilterController(
		this.artistClient,
		this.bubbles.pool,
		() => this.followService.followedArtists,
		{
			onBubblesReloaded: (artists) => this.dnaOrbCanvas.reloadBubbles(artists),
			onError: (key, params) =>
				this.ea.publish(new Snack(this.i18n.tr(key, params), 'error')),
		},
		resolve(ILogger).scopeTo('GenreFilterController'),
		() => this.abortController.signal,
	)

	public get poolBubbles(): Artist[] {
		return this.bubbles.poolBubbles
	}

	public get followedIds(): ReadonlySet<string> {
		return this.followService.followedIds
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get followedCount(): number {
		return this.followService.followedCount
	}

	public get showDashboardCoachMark(): boolean {
		return (
			this.isOnboarding &&
			(this.followedCount >= DASHBOARD_FOLLOW_TARGET ||
				this.concertService.artistsWithConcertsCount >=
					DASHBOARD_CONCERT_TARGET)
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

	@watch((vm: DiscoveryRoute) => vm.showDashboardCoachMark)
	protected onShowDashboardCoachMarkChanged(show: boolean): void {
		if (show && !this.dashboardCoachMarkShown) {
			this.dashboardCoachMarkShown = true
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

		if (this.isOnboarding) {
			const persisted = this.followService.guestFollows
			if (persisted.length > 0) {
				this.followService.hydrate(persisted.map((f) => f.artist))
			}
		}

		try {
			await this.bubbles.loadInitialArtists(
				this.followService.followedArtists,
				detectCountryFromTimezone(),
				'',
			)
		} catch (err) {
			this.logger.error('Failed to load initial artists', err)
			this.ea.publish(new Snack(this.i18n.tr('discovery.loadFailed'), 'error'))
		}

		// Resume concert search for pre-seeded follows (fire concurrently)
		if (this.isOnboarding) {
			for (const f of this.followService.guestFollows) {
				void this.searchConcertsForArtist(f.artist.id, f.artist.name)
			}
			// Sync initial counts — @watch only fires on changes, not on the
			// initial value, so we push the baseline explicitly after hydration.
			this.onboarding.setDiscoveryCounts(
				this.followedCount,
				this.concertService.artistsWithConcertsCount,
			)
		}
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)
	}

	public detaching(): void {
		this.abortController.abort()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.search.dispose()
		this.onboarding.deactivateSpotlight()
		this.onboarding.setDiscoveryCounts(0, 0)
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

	@watch((vm: DiscoveryRoute) => vm.followedCount)
	protected onFollowedCountChanged(): void {
		this.onboarding.setDiscoveryCounts(
			this.followedCount,
			this.concertService.artistsWithConcertsCount,
		)
	}

	@watch((vm: DiscoveryRoute) => vm.concertService.artistsWithConcertsCount)
	protected onArtistsWithConcertsCountChanged(): void {
		this.onboarding.setDiscoveryCounts(
			this.followedCount,
			this.concertService.artistsWithConcertsCount,
		)
	}

	public clearSearch(): void {
		this.search.clearSearch()
	}

	public async onGenreSelected(tag: string): Promise<void> {
		await this.genre.onGenreSelected(tag)
	}

	/**
	 * Reset the bubble field to the global Top 50, clearing any active genre
	 * filter and the accumulated similar-artist bubbles. Reuses the genre
	 * loading flag as the shared pool-reload guard so genre chips and the reset
	 * control disable together and concurrent reloads are prevented.
	 */
	public async onReset(): Promise<void> {
		if (this.genre.isLoadingTag) return
		this.logger.info('Resetting discovery bubbles to top artists')

		this.genre.clearActiveTag()
		this.genre.isLoadingTag = true
		try {
			await this.bubbles.reset(this.followService.followedArtists)
			if (this.abortController.signal.aborted) return
			this.dnaOrbCanvas.reloadBubbles(this.poolBubbles)
		} catch (err) {
			this.logger.error('Failed to reset discovery bubbles', err)
			this.ea.publish(new Snack(this.i18n.tr('discovery.resetFailed'), 'error'))
		} finally {
			this.genre.isLoadingTag = false
		}
	}

	public async onArtistSelected(
		event: CustomEvent<{
			artist: Artist
			position: { x: number; y: number }
		}>,
	): Promise<void> {
		const { artist, position } = event.detail
		const artistId = artist.id
		if (this.followedIds.has(artistId)) return
		this.logger.info('Artist selected from bubbles', {
			artist: artist.name,
		})

		// Analytics: bubble-tap simultaneously surfaces the artist on
		// screen (viewed) and expresses follow intent (follow.requested).
		// Both fire BEFORE the followService call so the events capture
		// intent regardless of follow outcome — backend
		// artist.follow.completed (PR #317) is the trust-critical outcome
		// signal that pairs with follow.requested for the funnel.
		this.analytics.capture(Events.ArtistDiscoveryViewed, {
			artist_id: artistId,
			source: 'discovery_orb',
		})
		this.analytics.capture(Events.ArtistFollowRequested, {
			artist_id: artistId,
			source: 'discovery_orb',
		})

		// Optimistic UI: remove from pool
		this.bubbles.pool.remove(artistId)

		try {
			await this.followService.follow(artist)
		} catch {
			// Rollback UI
			this.bubbles.pool.add([artist])
			this.dnaOrbCanvas.spawnBubblesAt([artist], position.x, position.y)
			return
		}
		if (this.abortController.signal.aborted) return

		void this.searchConcertsForArtist(artistId, artist.name)
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

	public async onFollowFromSearch(artist: Artist): Promise<void> {
		const artistId = artist.id
		if (this.followedIds.has(artistId)) return

		this.logger.info('Following artist from search', {
			artist: artist.name,
		})

		// Same intent-capture pattern as the bubble-tap path: both
		// viewed and follow.requested fire BEFORE the followService call
		// so search-driven discovery shows up in the funnel even when
		// the backend follow eventually fails.
		this.analytics.capture(Events.ArtistDiscoveryViewed, {
			artist_id: artistId,
			source: 'search_result',
		})
		this.analytics.capture(Events.ArtistFollowRequested, {
			artist_id: artistId,
			source: 'search_result',
		})

		try {
			await this.followService.follow(artist)
		} catch {
			return
		}
		if (this.abortController.signal.aborted) return

		// Transition to bubble view and play absorption animation
		this.search.clearSearch()
		this.search.exitSearchMode()

		this.bubbles.spawnAndAbsorbAfterSearch(artist, this.dnaOrbCanvas)

		void this.searchConcertsForArtist(artistId, artist.name)
	}

	public onCoachMarkTap(): void {
		this.logger.info('Onboarding: coach mark tapped, advancing to dashboard', {
			followedCount: this.followedCount,
		})
		this.onboarding.deactivateSpotlight()
		this.onboarding.setStep(OnboardingStep.DASHBOARD)
		void this.router.load('/dashboard')
	}

	/**
	 * Search for concerts for an artist. Updates artistsWithConcerts and shows
	 * a snack notification if concerts are found. Errors are logged but do not
	 * propagate — the follow operation remains successful regardless.
	 */
	private async searchConcertsForArtist(
		artistId: string,
		artistName: string,
	): Promise<void> {
		try {
			const concerts = await this.concertService.listConcerts(artistId)

			if (concerts.length > 0) {
				this.concertService.addArtistWithConcerts(artistId)
				if (!this.abortController.signal.aborted) {
					this.ea.publish(
						new Snack(
							this.i18n.tr('discovery.hasUpcomingEvents', {
								name: artistName,
							}),
						),
					)
				}
			}
		} catch (err) {
			this.logger.warn('Concert search failed for artist', {
				artistId,
				error: err,
			})
		}
	}
}
