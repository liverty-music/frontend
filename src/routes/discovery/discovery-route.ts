import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { IEventAggregator, ILogger, resolve, watch } from 'aurelia'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import { Snack } from '../../components/snack-bar/snack'
import type { Artist } from '../../entities/artist'
import { IArtistServiceClient } from '../../services/artist-service-client'
import { IConcertService } from '../../services/concert-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import { IGuestService } from '../../services/guest-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { detectCountryFromTimezone } from '../../util/detect-country'
import { BubbleManager } from './bubble-manager'
import { GenreFilterController } from './genre-filter-controller'
import { SearchController } from './search-controller'

const TUTORIAL_FOLLOW_TARGET = 3

export class DiscoveryRoute {
	private readonly artistClient = resolve(IArtistServiceClient)
	private readonly followService = resolve(IFollowServiceClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly router = resolve(IRouter)
	private readonly ea = resolve(IEventAggregator)
	private readonly guest = resolve(IGuestService)
	private readonly concertService = resolve(IConcertService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoveryRoute')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas

	private abortController = new AbortController()

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
			this.concertService.artistsWithConcertsCount >= TUTORIAL_FOLLOW_TARGET
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

		if (this.isOnboarding) {
			const persisted = this.guest.follows
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
			for (const f of this.guest.follows) {
				void this.searchConcertsForArtist(f.artist.id, f.artist.name)
			}
		}
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)

		if (this.isOnboarding) {
			this.ea.publish(
				new Snack(this.i18n.tr('discovery.popoverGuide'), 'info', {
					duration: 5000,
				}),
			)
		}
	}

	public detaching(): void {
		this.abortController.abort()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.search.dispose()
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
			const concerts = await this.concertService.searchNewConcerts(
				artistId,
				this.abortController.signal,
			)
			if (this.abortController.signal.aborted) return

			if (concerts.length > 0) {
				this.concertService.addArtistWithConcerts(artistId)
				this.ea.publish(
					new Snack(
						this.i18n.tr('discovery.hasUpcomingEvents', {
							name: artistName,
						}),
					),
				)
			}
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Concert search failed for artist', {
				artistId,
				error: err,
			})
		}
	}
}
