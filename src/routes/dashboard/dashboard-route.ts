import { I18N } from '@aurelia/i18n'
import type { Params, RouteNode } from '@aurelia/router'
import { ILogger, observable, resolve, watch } from 'aurelia'
import { IHistory } from '../../adapter/browser/history'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type {
	DateGroup,
	LiveEvent,
} from '../../components/live-highway/live-event'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { StorageKeys } from '../../constants/storage-keys'
import type { Artist, CountedArtist } from '../../entities/artist'
import type { Concert, JourneyStatus } from '../../entities/concert'
import { isJourneyStatus } from '../../entities/ticket-journey'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'
import { IResumeRevalidator } from '../../services/resume-revalidator'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserStore } from '../../services/user-store'

export class DashboardRoute {
	public dateGroups: DateGroup[] = []
	@observable public filteredArtistIds: string[] = []
	@observable public filteredStatuses: JourneyStatus[] = []
	public needsRegion = false
	public isLoading = false
	// Readiness latch flipped true by loadData() once a successful (non-abort)
	// fetch settles and isLoading has cleared. Its @observable change handler
	// re-anchors the data-ready side effects (celebration + completion latch) to
	// observed data arrival, replacing the old attached()-timing assumption that
	// loading() had already awaited the fetch.
	@observable public timetableLoaded = false
	public loadError: unknown = null
	public showSignupBanner = false
	public showPostSignupDialog = false

	// Celebration overlay state (two tiers, gated on timetable readiness).
	public showCelebration = false
	public celebrationConfetti = false
	public celebrationMessage = ''
	public celebrationSubMessage = ''
	private celebrationLeadsToDialog = false

	public homeSelector: UserHomeSelector | undefined
	public detailSheet: EventDetailSheet | undefined

	private readonly logger = resolve(ILogger).scopeTo('DashboardRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertService = resolve(IConcertStore)
	private readonly followStore = resolve(IFollowStore)
	private readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly userStore = resolve(IUserStore)
	private readonly storage = resolve(ILocalStorage)
	private readonly history = resolve(IHistory)
	private readonly resumeRevalidator = resolve(IResumeRevalidator)
	private abortController: AbortController | null = null

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	/**
	 * An unauthenticated visitor with zero followed artists. Under the soft gate
	 * the dashboard is always reachable; this surfaces an in-page empty-state CTA
	 * toward discovery instead of a guard redirect.
	 */
	public get showGuestEmptyState(): boolean {
		return !this.isAuthenticated && this.followStore.followedCount === 0
	}

	public get followedArtists(): Artist[] {
		return this.followStore.followedArtists
	}

	public get filteredDateGroups(): DateGroup[] {
		const ids = new Set(this.filteredArtistIds)
		const statuses = new Set(this.filteredStatuses)
		const noArtist = ids.size === 0
		const noStatus = statuses.size === 0

		// One `keep` predicate combining both facets: artist (OR within) AND
		// journey (OR within). The leading `!!c.artistId` guard always strips
		// blank-artistId concerts before rendering. Post-v0.41.0 `concertFrom`
		// returns `artistId: ''` when no performer resolved against the user's
		// artistMap (ID-namespace mismatch, schema-skew rollout window) — those
		// rows have no usable artist context and would render as ghost cards
		// with empty names, so they never surface on the dashboard.
		const keep = (c: Concert): boolean =>
			!!c.artistId &&
			(noArtist || ids.has(c.artistId)) &&
			(noStatus ||
				(c.journeyStatus !== undefined && statuses.has(c.journeyStatus)))

		return this.dateGroups
			.map((g) => ({
				...g,
				home: g.home.filter(keep),
				nearby: g.nearby.filter(keep),
				away: g.away.filter(keep),
			}))
			.filter((g) => g.home.length + g.nearby.length + g.away.length > 0)
	}

	/**
	 * Followed artists projected with their upcoming-concert count, computed over
	 * the *unfiltered* `dateGroups` so counts stay stable as the user toggles
	 * chips. Zero-concert artists are hidden; the rest are sorted by count
	 * descending, ties broken by name ascending. A plain getter — Aurelia 2
	 * auto-tracks the observable `dateGroups`/`followedArtists` it reads.
	 */
	public get countedArtists(): CountedArtist[] {
		const counts = new Map<string, number>()
		for (const group of this.dateGroups) {
			for (const concert of [...group.home, ...group.nearby, ...group.away]) {
				if (!concert.artistId) continue
				counts.set(concert.artistId, (counts.get(concert.artistId) ?? 0) + 1)
			}
		}
		return this.followedArtists
			.map((artist) => ({
				id: artist.id,
				name: artist.name,
				count: counts.get(artist.id) ?? 0,
			}))
			.filter((artist) => artist.count > 0)
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
	}

	/**
	 * Single URL writer for both facets. Driven by one `@watch` keyed on a
	 * composite of both arrays so two selections committed in the same tick
	 * (e.g. on confirm) collapse into a single async-batched `replaceState`,
	 * never a double write that drops one facet. Params are omitted when empty.
	 */
	@watch(
		(vm: DashboardRoute) =>
			`${vm.filteredArtistIds.join(',')}|${vm.filteredStatuses.join(',')}`,
	)
	protected syncFilterUrl(): void {
		const parts: string[] = []
		if (this.filteredArtistIds.length > 0) {
			parts.push(`artists=${this.filteredArtistIds.join(',')}`)
		}
		if (this.filteredStatuses.length > 0) {
			parts.push(`journey=${this.filteredStatuses.join(',')}`)
		}
		const url =
			parts.length > 0 ? `/dashboard?${parts.join('&')}` : '/dashboard'
		this.history.replaceState(null, '', url)
	}

	public async loading(_params?: Params, next?: RouteNode): Promise<void> {
		// Restore filters from URL query params (ignored during onboarding)
		if (!this.isOnboarding && next) {
			const rawArtists = next.queryParams.get('artists')
			this.filteredArtistIds = rawArtists
				? rawArtists.split(',').filter(Boolean)
				: []

			// Journey filter is authenticated-only: a guest's `journey` param has
			// no effect, so it can never narrow their highway to an empty state.
			// Unknown tokens are silently dropped; valid ones still apply.
			const rawJourney = this.authService.isAuthenticated
				? next.queryParams.get('journey')
				: null
			this.filteredStatuses = rawJourney
				? rawJourney.split(',').filter(isJourneyStatus)
				: []
		}

		if (this.authService.isAuthenticated) {
			this.needsRegion = !this.userStore.current?.home
		} else {
			this.needsRegion = !UserHomeSelector.getStoredHome()
		}

		// Fire-and-forget. loadData() self-selects the fast path (cache paint +
		// background refresh) or the cold-load path (spinner + full fetch).
		void this.loadData()

		// Show signup banner for unauthenticated users who completed onboarding
		if (!this.authService.isAuthenticated && this.onboarding.isCompleted) {
			this.showSignupBanner = true
		}
	}

	public async loadData(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.loadError = null

		// Fast path: we have a previous render for this user — paint it instantly
		// (no spinner) then refresh in the background. Works for both guest and
		// authenticated because lastDateGroups lives in the ConcertStore singleton,
		// which survives DashboardRoute re-instantiation on every navigation.
		const cachedDateGroups = this.concertService.peekDateGroups()
		if (cachedDateGroups !== null && !this.needsRegion) {
			this.dateGroups = cachedDateGroups
			this.timetableLoaded = true
			void this.refreshInBackground()
			return
		}

		// Cold load: first visit, or follow set changed, or region not set.
		this.isLoading = true
		// Reset so every load produces a fresh false→true transition; the
		// needsRegion→onHomeSelected path loads twice and the second arrival must
		// still re-fire the gated handler.
		this.timetableLoaded = false
		const signal = this.abortController.signal

		let succeeded = false
		try {
			this.dateGroups = await this.loadDashboardEvents(signal)
			this.loadError = null
			this.logger.info('Dashboard loaded', {
				groups: this.dateGroups.length,
			})
			succeeded = true
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('Failed to load dashboard', { error: err })
			if (this.dateGroups.length === 0) {
				this.loadError = err
			}
		} finally {
			this.isLoading = false
		}

		// Flip AFTER isLoading clears so the gated handler never evaluates the
		// celebration over a still-loading spinner. Only on a genuine (non-abort)
		// successful load — an aborted load returns early above and leaves this
		// false so a stale arrival can't fire the celebration.
		if (succeeded) {
			this.timetableLoaded = true
		}
	}

	private async loadDashboardEvents(
		signal?: AbortSignal,
	): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')

		const [artistMap, groups, journeyMap] = await Promise.all([
			this.followStore.getFollowedArtistMap(signal),
			this.concertService.listByFollower(signal),
			this.fetchJourneyMap(signal),
		])

		if (groups.length === 0) {
			this.logger.info('No concert groups returned')
			// Cache the empty result so re-entry shows the empty state immediately
			// rather than a spinner, then refreshes in the background.
			this.concertService.setDateGroups([])
			return []
		}

		const result = this.concertService.toDateGroups(
			groups,
			artistMap,
			journeyMap,
		)
		// Persist the rendered output in the singleton so the next DashboardRoute
		// instance (re-created on every navigation) paints instantly on re-entry.
		this.concertService.setDateGroups(result)
		return result
	}

	private async fetchJourneyMap(
		signal?: AbortSignal,
	): Promise<Map<string, JourneyStatus>> {
		// The store owns the journey map (network-first, guest→empty). A fetch
		// failure must not blank the dashboard, so fall back to an empty map.
		try {
			return await this.journeyStore.load(signal)
		} catch (err) {
			this.logger.warn('Journey fetch failed, continuing without statuses', {
				error: err,
			})
			return new Map()
		}
	}

	/**
	 * Keep the concerts' rendered `journeyStatus` in sync with the single source
	 * of truth: when the store's observable map changes (e.g. a write from the
	 * detail sheet), re-stamp each concert in place so the dashboard cards and
	 * journey filter reflect the change without a re-fetch or route re-entry.
	 */
	@watch((vm: DashboardRoute) => vm.journeyStore.journeyMap)
	protected onJourneyMapChanged(map: Map<string, JourneyStatus>): void {
		for (const group of this.dateGroups) {
			for (const concert of [...group.home, ...group.nearby, ...group.away]) {
				if (concert.id) {
					concert.journeyStatus = map.get(concert.id)
				}
			}
		}
	}

	/**
	 * Fetch fresh data in the background and swap it in place — no spinner, no
	 * scroll reset. Called after the cache paint on re-entry, and on PWA resume.
	 */
	public readonly revalidate = (): void => {
		void this.refreshInBackground()
	}

	private async refreshInBackground(): Promise<void> {
		if (this.needsRegion || this.isLoading) return
		const signal = this.abortController?.signal
		try {
			const fresh = await this.loadDashboardEvents(signal)
			if (signal?.aborted) return
			this.dateGroups = fresh
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Dashboard background refresh failed', { error: err })
		}
	}

	public attached(): void {
		// Revalidate the dashboard's cached concert list when the installed PWA
		// returns to the foreground. Only the active route is registered, so the
		// resume signal never fans out to inactive routes' stores.
		this.resumeRevalidator.register(this.revalidate)

		// Open the home selector when the user has no region set.
		// Done in attached() so the BottomSheet is in the DOM and showPopover() works.
		if (this.needsRegion) {
			this.homeSelector?.open()
		}
		// The celebration + completion-latch decisions are NO LONGER run here.
		// loading() now fires the fetch non-blocking, so attached() can run while
		// the timetable is still a spinner. The decisions are re-anchored to
		// observed data arrival via timetableLoadedChanged().
	}

	/**
	 * Re-anchor the data-ready side effects to observed data arrival. loadData()
	 * flips timetableLoaded true once a successful fetch settles AND isLoading has
	 * cleared, from BOTH arrival paths (loading()-driven and onHomeSelected-driven),
	 * so the celebration never renders over a spinner and the completion latch
	 * never reads not-yet-loaded engagement data. Guarded so it only acts on the
	 * true edge and only when the timetable is genuinely real.
	 */
	protected timetableLoadedChanged(loaded: boolean): void {
		if (!loaded) return
		if (this.needsRegion || this.isLoading) return
		this.onTimetableReady()
	}

	public async onHomeSelected(code: string): Promise<void> {
		this.logger.info('Home area configured', { code })
		this.needsRegion = false
		if (!this.authService.isAuthenticated) {
			this.userStore.setGuestHome(code)
		}
		// Timetable becomes real once the region is chosen; loadData() flips
		// timetableLoaded → timetableLoadedChanged() runs the deferred celebration
		// + completion-latch decisions. No explicit call needed here.
		await this.loadData()
	}

	/**
	 * Decisions that fire once the dashboard timetable is real (region set, data
	 * loaded), from either arrival path. The completion latch is evaluated AFTER
	 * the celebration decision (so maybeCelebrate observed isOnboarding === true)
	 * but is driven by the data-ready + engaged condition, not by whether the
	 * overlay actually rendered (see maybeCelebrate / onCelebrationDismissed).
	 */
	private onTimetableReady(): void {
		this.maybeCelebrate()
		this.maybeFinishOnboarding()
	}

	/**
	 * Show the celebration overlay once the dashboard timetable is real (region
	 * set, data loaded). Two tiers, each shown at most once:
	 *  - Post-signup (authenticated, first signup): full confetti, then opens
	 *    the PostSignupDialog on dismissal.
	 *  - Guest first dashboard arrival: light (no confetti) acknowledgement.
	 */
	private maybeCelebrate(): void {
		if (this.showCelebration || this.needsRegion) return

		if (this.authService.isAuthenticated) {
			if (this.storage.getItem(StorageKeys.postSignupShown) !== 'pending') {
				return
			}
			this.storage.removeItem(StorageKeys.postSignupShown)
			this.celebrationConfetti = true
			this.celebrationMessage = this.i18n.tr('dashboard.celebration.welcome')
			this.celebrationSubMessage = this.i18n.tr('dashboard.celebration.explore')
			this.celebrationLeadsToDialog = true
			this.showCelebration = true
			return
		}

		// Light tier is the onboarding creation payoff: only fire while the guest
		// is still in the onboarding flow (genuine first dashboard arrival), not
		// for a completed guest revisiting the dashboard.
		if (!this.onboarding.isOnboarding) return
		if (this.storage.getItem(StorageKeys.celebrationShown) === '1') return
		this.celebrationConfetti = false
		this.celebrationMessage = this.i18n.tr('dashboard.celebration.complete')
		this.celebrationSubMessage = this.i18n.tr('dashboard.celebration.explore')
		this.celebrationLeadsToDialog = false
		this.showCelebration = true
	}

	/**
	 * Completion latch (B1): mark onboarding finished on the guest's first
	 * MEANINGFUL dashboard arrival — the timetable is real (region set, data
	 * loaded) AND the guest has actually engaged (`followedCount >= 1`).
	 *
	 * Driven purely by the data-ready + engaged condition, NOT by whether the
	 * celebration overlay rendered: a guest with `celebrationShown === '1'` (so
	 * the light celebration is suppressed) must still latch. A zero-follow arrival
	 * (deep-link to the empty-state dashboard) must NOT latch, so the discovery
	 * coach mark and page-help auto-open still apply until the guest follows an
	 * artist. `finish()` is idempotent and one-way.
	 */
	private maybeFinishOnboarding(): void {
		if (this.needsRegion) return
		if (!this.onboarding.isOnboarding) return
		if (this.followStore.followedCount < 1) return
		this.onboarding.finish()
	}

	/**
	 * Persist the "guest light celebration already seen" flag only once the
	 * overlay actually opens. Burning the flag inside maybeCelebrate() would mean a
	 * suppressed overlay (never rendered) consumes the one-shot and the celebration
	 * never appears again. The post-signup tier has its own one-shot
	 * (postSignupShown), so this guard is scoped to the guest/light tier.
	 */
	public onCelebrationOpened(): void {
		if (this.authService.isAuthenticated) return
		this.storage.setItem(StorageKeys.celebrationShown, '1')
	}

	public onCelebrationDismissed(): void {
		this.showCelebration = false
		// Sequence: emotion → setup. Post-signup celebration hands off to the
		// PostSignupDialog (notifications / PWA install) on dismissal.
		if (this.celebrationLeadsToDialog) {
			this.celebrationLeadsToDialog = false
			this.showPostSignupDialog = true
		}
	}

	public onEventSelected(event: CustomEvent<{ event: LiveEvent }>): void {
		// Tag the source as the dashboard so concert.detail.viewed events from
		// the dashboard concert list are attributable to that surface in PostHog.
		this.detailSheet?.open(event.detail.event, 'dashboard')
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	public detaching(): void {
		this.resumeRevalidator.unregister(this.revalidate)
		this.abortController?.abort()
		this.abortController = null
	}
}
