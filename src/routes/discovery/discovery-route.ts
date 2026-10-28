import { I18N } from '@aurelia/i18n'
import type { Params, RouteNode } from '@aurelia/router'
import {
	IEventAggregator,
	ILogger,
	observable,
	resolve,
	runTasks,
	watch,
} from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import { IHistory } from '../../adapter/browser/history'
import {
	type DiscoveryView,
	loadDiscoveryView,
	saveDiscoveryView,
} from '../../adapter/storage/discovery-view-storage'
import { NearbyVisit } from '../../components/all-nearby/nearby-concerts'
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
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { helpAction, IFabMenuService } from '../../services/fab-menu-service'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'
import { IResumeRevalidator } from '../../services/resume-revalidator'
import { currentLanguage } from '../../util/change-locale'
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
	public readonly fabMenu = resolve(IFabMenuService)
	private readonly history = resolve(IHistory)
	private readonly authService = resolve(IAuthService)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly logger = resolve(ILogger).scopeTo('DiscoveryRoute')
	public readonly i18n = resolve(I18N)

	public dnaOrbCanvas!: DnaOrbCanvas

	/**
	 * The view on screen: the artist bubbles or the All Nearby view. Chosen in
	 * loading() from the address, the device's last choice and onboarding; the
	 * swap tile switches it (see switchView).
	 */
	@observable public view: DiscoveryView = 'artists'

	/**
	 * The All Nearby view's area, date range and results for this visit, so
	 * switching to the bubbles and back finds them unchanged. A new visit (a new
	 * route instance) starts empty.
	 */
	public readonly nearbyVisit = new NearbyVisit()

	/** The swap tile; the All Nearby view grows out of its centre. */
	public swapTile: HTMLElement | undefined

	/** True while a swap's View Transition runs (names the layout for it). */
	public revealing = false

	/** A guest tapped follow in the All Nearby view: offer sign-up. */
	public showSignupBanner = false

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	/** A guest tapped follow in the All Nearby view. */
	public offerSignUp(): void {
		if (this.isAuthenticated) return
		this.showSignupBanner = true
	}

	public onSignupRequested(): void {
		this.errorBoundary.addBreadcrumb('action', 'start_sign_up')
		this.authService.signUp({
			uiLocales: currentLanguage(this.i18n),
			source: 'all_nearby_prompt',
		})
	}

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
	 * Report once per visit the moment the onboarding progress row is shown
	 * as the link to the Dashboard, with the counts that made it ready. The
	 * row is hidden in search mode, so a follow from search results reports
	 * when the search closes.
	 */
	@watch((vm: DiscoveryRoute) => vm.showProgressRow && vm.readiness >= 1)
	protected onTimetableReadyChanged(ready: boolean): void {
		if (!ready || this.readyReported) return
		this.readyReported = true
		this.analytics.capture(Events.OnboardingTimetableReady, {
			followed_count: this.followedCount,
			artists_with_concerts_count: this.artistsWithConcertsCount,
		})
	}

	/**
	 * The onboarding progress row shows while onboarding, on the artist bubbles
	 * outside search mode.
	 */
	public get showProgressRow(): boolean {
		return (
			this.isOnboarding && !this.search.isSearchMode && this.view === 'artists'
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
					count: this.bubbleStore.shownArtistCount,
				}),
			)
		}
		parts.push(
			this.i18n.tr('discovery.srFollowed', { count: this.followedCount }),
		)
		return parts.join('. ')
	}

	public loading(_params?: Params, next?: RouteNode): void {
		this.logger.info('Loading discovery page')
		// `view=nearby` in the address wins at any onboarding state; otherwise
		// the device's last choice, except while onboarding, which always starts
		// on the bubbles.
		this.view =
			next?.queryParams.get('view') === 'nearby'
				? 'nearby'
				: this.isOnboarding
					? 'artists'
					: loadDiscoveryView()
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
		// Opened on the All Nearby view: the bubbles are not shown, so they do
		// not run, and the address names the view.
		if (this.view === 'nearby') {
			this.dnaOrbCanvas?.pause()
			this.writeViewAddress()
		}
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
		} else if (this.bubblesShown) {
			this.dnaOrbCanvas?.resume()
		}
	}

	/** Whether the bubble field is on screen: the bubbles, outside search. */
	private get bubblesShown(): boolean {
		return this.view === 'artists' && !this.search.isSearchMode
	}

	// --- Swap between the artist bubbles and the All Nearby view ---

	/**
	 * The swap tile was tapped. The new view grows as a circle out of the tile
	 * inside a View Transition; without the API, or with a reduced-motion
	 * preference, it changes at once. The callback flushes Aurelia's queue
	 * synchronously (`runTasks()`) and returns nothing: the browser suspends
	 * rAF while it snapshots, so a promise settled on a frame would never
	 * resolve and the transition would time out.
	 */
	public switchView(): void {
		// A tap while a swap is still revealing is ignored: a second View
		// Transition would skip the first, whose cleanup would then clear the
		// flags the second one still needs.
		if (this.revealing) return
		const next: DiscoveryView = this.view === 'nearby' ? 'artists' : 'nearby'
		const doc = document as Document & {
			startViewTransition?: (cb: () => void) => { finished: Promise<void> }
		}
		const reduce = window.matchMedia?.(
			'(prefers-reduced-motion: reduce)',
		).matches
		if (!doc.startViewTransition || reduce) {
			this.applyView(next)
			return
		}
		this.markRevealOrigin()
		// Name the layout before the old snapshot is taken, so the old and new
		// views pair up and only the new one animates; the page chrome swaps
		// without a cross-fade.
		const root = document.documentElement
		root.classList.add('vt-suppress-root')
		this.revealing = true
		runTasks()
		const transition = doc.startViewTransition(() => {
			this.applyView(next)
			runTasks()
		})
		void transition.finished.finally(() => {
			root.classList.remove('vt-suppress-root')
			this.revealing = false
		})
	}

	/** Publish the tile's centre for the reveal's circle (see global.css). */
	private markRevealOrigin(): void {
		const tile = this.swapTile?.getBoundingClientRect()
		const layout = this.swapTile?.parentElement?.getBoundingClientRect()
		if (!tile || !layout) return
		const style = document.documentElement.style
		style.setProperty('--swap-x', `${tile.x + tile.width / 2 - layout.x}px`)
		style.setProperty('--swap-y', `${tile.y + tile.height / 2 - layout.y}px`)
	}

	/**
	 * The All Nearby view hides the bubble field, so the simulation pauses on
	 * the way in, and resumes on the way out unless search mode is on or the
	 * document is hidden.
	 */
	protected viewChanged(view: DiscoveryView): void {
		if (view === 'nearby') {
			this.dnaOrbCanvas?.pause()
		} else if (this.bubblesShown && !document.hidden) {
			this.dnaOrbCanvas?.resume()
		}
	}

	/**
	 * A switch rewrites the address in place (no history entry, so Back leaves
	 * Discovery as before) and is remembered on the device for the next visit.
	 */
	private applyView(view: DiscoveryView): void {
		this.view = view
		this.writeViewAddress()
		saveDiscoveryView(view)
	}

	private writeViewAddress(): void {
		this.history.replaceState(
			null,
			'',
			this.view === 'nearby' ? '/discovery?view=nearby' : '/discovery',
		)
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
