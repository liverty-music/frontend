import { I18N } from '@aurelia/i18n'
import { IEventAggregator, ILogger, resolve, watch } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import { preloadPhysics } from '../../components/dna-orb/bubble-physics'
import type { DnaOrbCanvas } from '../../components/dna-orb/dna-orb-canvas'
import type { RevealMark } from '../../components/dna-orb/reveal-marks'
import type { PageHelp } from '../../components/page-help/page-help'
import { timetableReadiness } from '../../constants/onboarding'
import type { Artist } from '../../entities/artist'
import {
	Events,
	IAnalyticsService,
} from '../../lib/analytics/analytics-service'
import { IArtistBubbleStore } from '../../services/artist-bubble-store'
import { IArtistStore } from '../../services/artist-store'
import { IConcertStore } from '../../services/concert-store'
import { helpAction, IFabMenuService } from '../../services/fab-menu-service'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'
import { IResumeRevalidator } from '../../services/resume-revalidator'
import { GenreFilterController } from './genre-filter-controller'
import { detectRevealEntry, RevealTiming } from './reveal-timing'
import { SearchController } from './search-controller'

export class DiscoveryRoute {
	private readonly artistClient = resolve(IArtistStore)
	public readonly bubbleStore = resolve(IArtistBubbleStore)
	private readonly followStore = resolve(IFollowStore)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly ea = resolve(IEventAggregator)
	private readonly concertService = resolve(IConcertStore)
	private readonly analytics = resolve(IAnalyticsService)
	private readonly resumeRevalidator = resolve(IResumeRevalidator)
	private readonly fabMenu = resolve(IFabMenuService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoveryRoute')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas

	/** Help sheet ref; its trigger lives in the FAB launcher. */
	public pageHelp: PageHelp | undefined
	/** Disposer for this route's contributed FAB actions. */
	private fabDisposer: (() => void) | null = null

	private abortController = new AbortController()
	/** Whether this visit already reported the timetable as ready. */
	private readyReported = false
	// Cold-load reveal timing of this visit; null on a re-entry, once sent, and
	// after leaving the route.
	private revealTiming: RevealTiming | null = null

	// Controllers
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
		this.bubbleStore,
		{
			onError: (key, params) =>
				this.ea.publish(new Snack(this.i18n.tr(key, params), 'error')),
		},
		resolve(ILogger).scopeTo('GenreFilterController'),
		() => this.abortController.signal,
	)

	public get followedIds(): ReadonlySet<string> {
		return this.followStore.followedIds
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get followedCount(): number {
		return this.followStore.followedCount
	}

	public get artistsWithConcertsCount(): number {
		return this.concertService.artistsWithConcertsCount
	}

	/** How close the onboarding timetable is to ready, from 0 to 1. */
	public get readiness(): number {
		return timetableReadiness(this.followedCount, this.artistsWithConcertsCount)
	}

	/**
	 * Report once per visit the moment the onboarding progress row becomes the
	 * link to the Dashboard, with the counts that made it ready.
	 */
	@watch((vm: DiscoveryRoute) => vm.isOnboarding && vm.readiness >= 1)
	protected onTimetableReadyChanged(ready: boolean): void {
		if (!ready || this.readyReported) return
		this.readyReported = true
		this.analytics.capture(Events.OnboardingTimetableReady, {
			followed_count: this.followedCount,
			artists_with_concerts_count: this.artistsWithConcertsCount,
		})
	}

	/** The onboarding progress row shows while onboarding, outside search mode. */
	public get showProgressRow(): boolean {
		return this.isOnboarding && !this.search.isSearchMode
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
					count: this.bubbleStore.shownArtistCount,
				}),
			)
		}
		parts.push(
			this.i18n.tr('discovery.srFollowed', { count: this.followedCount }),
		)
		return parts.join('. ')
	}

	public loading(): void {
		this.logger.info('Loading discovery page')
		const openedAt = performance.now()
		const entry = detectRevealEntry()
		// Fetch the physics engine while the route is composed; the canvas cannot
		// draw even ghost bubbles before it loads. A failure surfaces at init.
		preloadPhysics().catch(() => undefined)

		// Synchronous onboarding hydrate prelude runs before the fetch so seeded
		// follows are present when the bubble field loads.
		if (this.isOnboarding) {
			const persisted = this.followStore.guestFollows
			if (persisted.length > 0) {
				this.followStore.hydrate(persisted.map((f) => f.artist))
			}
		}

		// Per-visit reset (re-detect country); the field owner keeps its cached
		// field across the route churn.
		this.bubbleStore.enterRoute(window.innerWidth)

		// Prepare the instant paint: the field owner is an app-singleton that holds
		// the in-session field across route churn, so a re-entry re-applies
		// invariants to its persisted field (dropping artists followed while away)
		// and a cold visit shows ghost placeholders. The background refresh then
		// preserves the in-session field (non-destructive delta) rather than
		// re-rolling it, unless it has gone stale.
		const cold = this.bubbleStore.prepareEntry()
		// A page load is measured from the document's start, an in-app entry from
		// this hook. Only a cold visit (no cached field, so ghosts were prepared)
		// reports its reveal, even when the artists arrive before a ghost is drawn.
		this.revealTiming = cold
			? new RevealTiming(entry, entry === 'page_load' ? 0 : openedAt)
			: null
		void this.refreshField()

		// Resume concert search for pre-seeded follows (fire concurrently)
		if (this.isOnboarding) {
			for (const f of this.followStore.guestFollows) {
				void this.searchConcertsForArtist(f.artist.id, f.artist.name)
			}
		}
	}

	/**
	 * Kick off the background field refresh on route entry. Returns a Promise so
	 * production fires it non-blocking (`void`) while tests await it
	 * deterministically. Waits for the fan's follows first (usually already
	 * loaded at boot by `FollowPrefetchTask`), so a signed-in fan who opens
	 * Discovery directly gets seed-similar bubbles without their followed
	 * artists. Then delegates to the field owner, which reuses the fresh
	 * in-session field with a non-destructive delta (or reloads when stale). A
	 * failure surfaces a Snack and is swallowed.
	 */
	public async refreshField(): Promise<void> {
		try {
			await this.followStore.ensureLoaded()
		} catch (err) {
			// Without follows the field falls back to top artists; still load it.
			this.logger.warn('Failed to load follows for the discovery field', {
				error: err,
			})
		}
		if (this.abortController.signal.aborted) return
		try {
			await this.bubbleStore.reenter()
		} catch (err) {
			this.logger.error('Failed to refresh discovery field', err)
			this.ea.publish(new Snack(this.i18n.tr('discovery.loadFailed'), 'error'))
		}
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)
		this.resumeRevalidator.register(this.revalidate)
		// Contribute the help action to the FAB launcher (this page has help).
		this.fabDisposer = this.fabMenu.register(this, [
			helpAction(() => this.pageHelp?.open()),
		])
	}

	public detaching(): void {
		this.revealTiming = null
		this.abortController.abort()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.resumeRevalidator.unregister(this.revalidate)
		this.fabDisposer?.()
		this.fabDisposer = null
		this.search.dispose()
	}

	/**
	 * On PWA resume, refresh the cached top-artist pool the user is actually
	 * looking at (whatever country/tag/limit was last requested) in the background,
	 * so the next bubble load / route re-entry uses fresh data. The visible physics
	 * field is intentionally NOT reloaded in place — that fights the canvas
	 * lifecycle and would rearrange bubbles under the user; warming the cache is the
	 * non-destructive equivalent for this route.
	 */
	public readonly revalidate = (): void => {
		void this.artistClient.revalidateLastTop().catch((err) => {
			this.logger.warn('Top-artist revalidation failed', { error: err })
		})
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

	/**
	 * Reset the bubble field to the global Top 50, clearing any active genre
	 * filter and the accumulated similar-artist bubbles. Reuses the genre
	 * loading flag as the shared reload guard so genre chips and the reset
	 * control disable together and concurrent reloads are prevented.
	 */
	public async onReset(): Promise<void> {
		if (this.genre.isLoadingTag) return
		this.logger.info('Resetting discovery bubbles to top artists')

		this.genre.clearActiveTag()
		this.genre.isLoadingTag = true
		try {
			await this.bubbleStore.reset()
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

		// Optimistic UI: remove from the field (reconcile fades the body out).
		this.bubbleStore.remove(artistId)

		try {
			await this.followStore.follow(artist)
		} catch {
			// Rollback: re-add at the tap position (reconcile pops it back in).
			this.bubbleStore.addAt([artist], position)
			this.publishFollowFailed(artist)
			return
		}
		if (this.abortController.signal.aborted) return

		void this.searchConcertsForArtist(artistId, artist.name)
	}

	/**
	 * A cold-load reveal milestone drawn by the canvas. Once all three have
	 * fired, send one reveal-timing event for this visit.
	 */
	public onRevealMark(
		event: CustomEvent<{ mark: RevealMark; time: number }>,
	): void {
		const timings = this.revealTiming?.record(
			event.detail.mark,
			event.detail.time,
		)
		if (!timings) return
		this.revealTiming = null
		const load = this.bubbleStore.lastInitialLoad
		if (!load) return
		this.analytics.capture(Events.DiscoveryReveal, {
			...timings,
			path: load.path,
			seed_count: load.seedCount,
		})
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
			const spawned = await this.bubbleStore.loadSimilar(artistId, position)
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
			await this.followStore.follow(artist)
		} catch {
			// The store rolled the follow back; stay in search mode so the fan
			// can try again from the same results.
			this.publishFollowFailed(artist)
			return
		}
		if (this.abortController.signal.aborted) return

		// Transition to bubble view and play absorption animation
		this.search.clearSearch()
		this.search.exitSearchMode()

		// Remove from the field so the reconcile fades out any existing physics
		// bubble for this artist; the absorb animation is a transient flourish.
		this.bubbleStore.remove(artistId)

		this.dnaOrbCanvas.spawnAndAbsorbAfterSearch(artist)

		void this.searchConcertsForArtist(artistId, artist.name)
	}

	private publishFollowFailed(artist: Artist): void {
		this.ea.publish(
			new Snack(
				this.i18n.tr('discovery.followFailed', { name: artist.name }),
				'error',
			),
		)
	}

	/**
	 * Look up the catalog's concerts for an artist. Updates artistsWithConcerts
	 * (which moves the onboarding progress row) and shows a snack notification
	 * if concerts are found. Errors are logged but do not propagate — the
	 * follow operation remains successful regardless.
	 */
	private async searchConcertsForArtist(
		artistId: string,
		artistName: string,
	): Promise<void> {
		try {
			const concerts = await this.concertService.listByArtist(artistId)

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
