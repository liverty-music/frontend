import { I18N } from '@aurelia/i18n'
import type { Params, RouteNode } from '@aurelia/router'
import { ILogger, observable, resolve, runTasks, watch } from 'aurelia'
import { IHistory } from '../../adapter/browser/history'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import type { DateRange } from '../../components/all-nearby/date-presets'
import { rangeCacheKey } from '../../components/all-nearby/date-presets'
import type {
	DateRangeSheet,
	RangeChangedDetail,
} from '../../components/all-nearby/date-range-sheet'
import type { ArtistFilterBar } from '../../components/artist-filter-bar/artist-filter-bar'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type {
	DateGroup,
	LiveEvent,
} from '../../components/live-highway/live-event'
import type { PageHelp } from '../../components/page-help/page-help'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { codeToHome } from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
import type { Artist, CountedArtist } from '../../entities/artist'
import type { Concert, JourneyStatus } from '../../entities/concert'
import { isJourneyStatus } from '../../entities/ticket-journey'
import {
	displayName,
	type GeoLocationInit,
	geoLocationFromLevel1,
} from '../../entities/user'
import {
	type CalendarDate,
	formatDateInput,
	parseDateInput,
	todayCalendarDate,
} from '../../lib/plain-date'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import {
	type FabAction,
	helpAction,
	IFabMenuService,
} from '../../services/fab-menu-service'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IResumeRevalidator } from '../../services/resume-revalidator'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserStore } from '../../services/user-store'

/** Dashboard concert view mode. Session-only — never persisted. */
export type ViewMode = 'timetable' | 'allNearby'

export class DashboardRoute {
	public dateGroups: DateGroup[] = []
	/** Beam-effect state; @observable so the FAB toggle item reflects it live. */
	@observable public showBeams = false
	@observable public filteredArtistIds: string[] = []
	@observable public filteredStatuses: JourneyStatus[] = []
	/**
	 * The active lower bound sent as `from` to ListByFollower. Defaults to the
	 * client's local date (today onward); a past date widens the timetable into
	 * the past. Restored from the `from` URL query param on load. Unlike the
	 * artist/journey facets (client-side narrowing), changing this re-fetches.
	 */
	@observable public fromDate: CalendarDate = todayCalendarDate()
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
	public areaSelector: UserHomeSelector | undefined
	public dateSheet: DateRangeSheet | undefined
	// The filter + help surfaces stay owned by the dashboard (their sheets and
	// bindings are unchanged); only their triggers moved into the FAB launcher.
	public filterBar: ArtistFilterBar | undefined
	public pageHelp: PageHelp | undefined
	/** Disposer for this route's contributed FAB actions; released in detaching(). */
	private fabDisposer: (() => void) | null = null

	/**
	 * Concert id from a `/concerts/:id` deep-link, pending resolution against the
	 * authoritative concert fetch. Null when navigated to a bare `/dashboard` or
	 * during onboarding. Self-clears once resolved so a PWA resume / background
	 * refresh never re-opens the sheet. See resolvePendingDeepLink.
	 */
	private pendingConcertId: string | null = null

	// --- All Nearby mode (session-only, never persisted) ---

	/**
	 * Active dashboard view. Route-local session state — a fresh DashboardRoute
	 * instance (created on every navigation) always starts on My Timetable.
	 */
	@observable public viewMode: ViewMode = 'timetable'

	/**
	 * Area override for All Nearby, an ISO 3166-2 code chosen via the area
	 * selector. Null means "use the user's home area". Not persisted — it does
	 * NOT call userStore.updateHome().
	 */
	public selectedAreaCode: string | null = null

	/** The active All Nearby date range, resolved by the date-range sheet. */
	public allNearbyRange: DateRange | null = null

	/**
	 * Display label for the date chip — a preset name (今週末 / 7日以内 / 30日以内)
	 * when a preset is active, else a localized range (e.g. `8/12〜8/20`). Supplied
	 * by the date-range sheet alongside the resolved range so the chip never
	 * re-derives it.
	 */
	public dateChipLabel = ''

	/** Derived DateGroup[] for the current All Nearby filter, rendered as-is. */
	public allNearbyDateGroups: DateGroup[] = []

	public allNearbyLoading = false
	public allNearbyError: unknown = null

	/**
	 * Route-local All Nearby cache, keyed by (adminArea + from + to). Kept
	 * separate from the My Timetable cache (owned by ConcertStore) so switching
	 * modes never refetches or disturbs either side; re-selecting All Nearby with
	 * unchanged filters reuses the cached DateGroup[].
	 */
	private readonly allNearbyCache = new Map<string, DateGroup[]>()

	/** AbortController for the in-flight All Nearby request, aborted on filter change. */
	private allNearbyAbort: AbortController | null = null

	private readonly logger = resolve(ILogger).scopeTo('DashboardRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertService = resolve(IConcertStore)
	private readonly fabMenu = resolve(IFabMenuService)
	private readonly followStore = resolve(IFollowStore)
	private readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)
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

	public get isAllNearby(): boolean {
		return this.viewMode === 'allNearby'
	}

	/**
	 * The effective area code for All Nearby: the explicit override, else the
	 * user's home area, else null (prompt the user to pick one).
	 */
	public get effectiveAreaCode(): string | null {
		return this.selectedAreaCode ?? this.userStore.currentHome
	}

	/** Display name of the effective All Nearby area, or empty when none is set. */
	public get selectedAreaName(): string {
		const code = this.effectiveAreaCode
		if (!code) return ''
		const lang = this.userStore.currentLanguage === 'ja' ? 'ja' : 'en'
		return displayName(code, lang)
	}

	/**
	 * True when All Nearby has no resolvable area yet (unauthenticated visitor
	 * with no home, no override). The area selector must be opened before any
	 * listByLocation call can run.
	 */
	public get allNearbyNeedsArea(): boolean {
		return this.effectiveAreaCode === null
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
			`${vm.filteredArtistIds.join(',')}|${vm.filteredStatuses.join(',')}|${formatDateInput(vm.fromDate)}`,
	)
	protected syncFilterUrl(): void {
		const parts: string[] = []
		if (this.filteredArtistIds.length > 0) {
			parts.push(`artists=${this.filteredArtistIds.join(',')}`)
		}
		if (this.filteredStatuses.length > 0) {
			parts.push(`journey=${this.filteredStatuses.join(',')}`)
		}
		// The date filter is a URL param only when it deviates from the today-onward
		// default; clearing it back to today drops the param (and reverts the view).
		if (!this.isDefaultFrom()) {
			parts.push(`from=${formatDateInput(this.fromDate)}`)
		}
		const url =
			parts.length > 0 ? `/dashboard?${parts.join('&')}` : '/dashboard'
		this.history.replaceState(null, '', url)
	}

	/** Whether the active `from` equals the client's local date (the default view). */
	private isDefaultFrom(): boolean {
		return sameCalendarDate(this.fromDate, todayCalendarDate())
	}

	/**
	 * The filter sheet committed a new date lower bound. Unlike the artist/journey
	 * facets (pure client-side narrowing over the loaded set), a `from` change alters
	 * what the server returns, so re-fetch. The store cache is keyed by `from`, so a
	 * previously loaded window returns instantly; a new window fetches once. The
	 * fast-path first-paint is not keyed by `from`, so drop the last rendered groups
	 * before reloading to avoid repainting the previous window. The @watch above then
	 * syncs the new date to the URL (or removes the param when back to today).
	 */
	public onDateFilterChanged(event: CustomEvent<CalendarDate>): void {
		const from = event.detail
		if (sameCalendarDate(from, this.fromDate)) return
		this.fromDate = from
		this.concertService.clearRenderedGroups()
		void this.loadData()
	}

	public toggleBeams(): void {
		this.showBeams = !this.showBeams
		this.storage.setItem(
			StorageKeys.beamsEnabled,
			this.showBeams ? 'true' : 'false',
		)
	}

	/**
	 * Build this route's FAB launcher action set for the current context. Order
	 * is DOM top→bottom (the panel expands upward, so the last item sits closest
	 * to the thumb): help, mode-swap, filter, beam (design D3). The beam toggle
	 * and the filter/mode commands are only present in My Timetable and outside
	 * onboarding — mirroring the header gating they replace.
	 */
	private buildFabActions(): FabAction[] {
		// Order is DOM top→bottom (the panel expands upward, so the last item sits
		// closest to the thumb): help, mode-swap, filter, beam (design D3).
		const actions: FabAction[] = [helpAction(() => this.pageHelp?.open())]

		// Mode swap: available in both views (names the destination).
		actions.push({
			id: 'mode-swap',
			// Names the OTHER view (the destination); recomputed on re-register.
			labelKey: this.swapLabelKey,
			icon: 'swap',
			kind: 'command',
			// Highlight while All Nearby is active (parity with the old header pill).
			isOn: () => this.isAllNearby,
			invoke: () => this.toggleMode(),
		})

		// Filter + beam are My Timetable-only (per the beam/filter specs). Only the
		// FILTER is additionally suppressed during onboarding (dashboard-artist-filter
		// spec: "Filter still suppressed during onboarding"); beam is not.
		if (!this.isAllNearby) {
			if (!this.isOnboarding) {
				actions.push({
					id: 'filter',
					labelKey: 'fabMenu.filter',
					icon: 'filter',
					kind: 'command',
					isOn: () => this.filterBar?.isFilterActive ?? false,
					invoke: () => this.filterBar?.openSheet(),
				})
			}
			actions.push({
				id: 'beam',
				labelKey: 'fabMenu.beam',
				icon: 'spotlight',
				kind: 'toggle',
				isOn: () => this.showBeams,
				invoke: () => this.toggleBeams(),
			})
		}
		return actions
	}

	/**
	 * (Re-)contribute this route's actions to the launcher. Owner-keyed, so a
	 * mode switch or onboarding transition replaces the set without accumulating
	 * (design D2). Re-runs on the context @watch below and on attach.
	 */
	private registerFabActions(): void {
		this.fabDisposer?.()
		this.fabDisposer = this.fabMenu.register(this, this.buildFabActions())
	}

	/**
	 * Re-register the FAB actions whenever the mode or onboarding state changes,
	 * so the launcher never shows a stale or duplicated set (My Timetable-only
	 * items must drop in All Nearby).
	 */
	@watch((vm: DashboardRoute) => `${vm.isAllNearby}|${vm.isOnboarding}`)
	protected onFabContextChanged(): void {
		this.registerFabActions()
	}

	public async loading(params?: Params, next?: RouteNode): Promise<void> {
		this.showBeams = this.storage.getItem(StorageKeys.beamsEnabled) === 'true'

		// Deep-link target from `/concerts/:id` (e.g. a tapped push notification).
		// Recorded here but resolved only after the authoritative listByFollower
		// fetch settles (see resolvePendingDeepLink), never off the cache paint.
		// Suppressed during onboarding, mirroring the query-param handling below.
		this.pendingConcertId = !this.isOnboarding && params?.id ? params.id : null

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

			// Restore the date lower bound from the `from` param. Missing/malformed
			// values are ignored (parseDateInput returns null) and fall back to the
			// client's local date (today onward). Setting this before loadData() means
			// the first fetch uses the restored window; the @watch above then writes
			// the (unchanged) URL back, a no-op.
			const rawFrom = next.queryParams.get('from')
			const parsedFrom = rawFrom ? parseDateInput(rawFrom) : null
			this.fromDate = parsedFrom ?? todayCalendarDate()
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
			// Cold-load path resolved the authoritative fetch above — safe to act on
			// a pending `/concerts/:id` deep-link now. The fast path resolves it in
			// refreshInBackground once the background fetch settles.
			this.resolvePendingDeepLink()
		}
	}

	/**
	 * Resolve a pending `/concerts/:id` deep-link against the authoritative concert
	 * list once it has settled — from the cold-load await or the background refresh,
	 * never off the cache first-paint.
	 *
	 * On match: derive the artist filter from the concert, flush that URL write,
	 * then open the detail sheet so the sheet's pushed `/concerts/:id` URL is the
	 * final history entry and wins while the sheet is open (two URL writers race —
	 * the sheet must win; the filter URL applies after close). On no match
	 * (unfollowed after send, zero-date, or unresolved performer): degrade silently
	 * — no sheet, no error. The artist is only derivable from the concert, so with
	 * the concert absent there is nothing to filter to; the view is left unchanged.
	 *
	 * Self-clears pendingConcertId so a later PWA resume or background refresh never
	 * re-opens the sheet.
	 */
	private resolvePendingDeepLink(): void {
		const id = this.pendingConcertId
		if (!id) return
		this.pendingConcertId = null

		const concert = this.findConcertById(id)
		if (!concert?.artistId) return

		this.filteredArtistIds = [concert.artistId]
		runTasks()
		this.detailSheet?.open(concert)
	}

	/** Find a concert by id across all lanes of the loaded date groups. */
	private findConcertById(id: string): Concert | undefined {
		for (const group of this.dateGroups) {
			const found =
				group.home.find((c) => c.id === id) ??
				group.nearby.find((c) => c.id === id) ??
				group.away.find((c) => c.id === id)
			if (found) return found
		}
		return undefined
	}

	private async loadDashboardEvents(
		signal?: AbortSignal,
	): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')

		const [artistMap, groups, journeyMap] = await Promise.all([
			this.followStore.getFollowedArtistMap(signal),
			this.concertService.listByFollower(this.fromDate, signal),
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
	/**
	 * Re-derive concert groups when the user's effective language changes.
	 * This fires once after UserHydrationTask resolves preferredLanguage from the
	 * server — e.g. a user with preferredLanguage='en' on a device whose i18n
	 * locale defaulted to 'ja'. refreshInBackground re-runs toDateGroups over the
	 * already-cached RPC data (no network round-trip) with the correct lang value.
	 */
	@watch((vm: DashboardRoute) => vm.userStore.currentLanguage)
	protected onCurrentLanguageChanged(): void {
		void this.refreshInBackground()
	}

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
			// Fast path: this background fetch is the authoritative list. Resolve any
			// pending `/concerts/:id` deep-link now that fresh data has settled.
			this.resolvePendingDeepLink()
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

		// Contribute this route's contextual FAB launcher actions.
		this.registerFabActions()

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
		// UserHomeSelector no longer persists — the onboarding caller owns it:
		// authenticated users write through UserService.updateHome, guests to
		// localStorage.
		if (this.authService.isAuthenticated) {
			try {
				await this.userStore.updateHome(codeToHome(code))
			} catch (err) {
				this.logger.error('Failed to update home via RPC', err)
			}
		} else {
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
			// Suppress the bottom-anchored pwa-install-banner for the whole
			// post-signup sequence (this celebration → PostSignupDialog) so it does
			// not overlap them (D7). Released by the dialog on dismissal, or by
			// detaching() if the user leaves mid-celebration.
			this.promptCoordinator.isPostSignupSurfaceOpen = true
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
		// Thread the All Nearby flag so the sheet surfaces the follow CTA only in
		// that context; My Timetable stays unchanged (isAllNearby === false).
		this.detailSheet?.open(event.detail.event, 'dashboard', this.isAllNearby)
	}

	// --- All Nearby mode ---

	/**
	 * The page-header title for the active mode. Timetable keeps the existing
	 * `nav.home` title (unchanged from every other page); All Nearby swaps to its
	 * own title. Both render in the same shared page-header H1, so the dashboard
	 * stays structurally consistent with the other routes.
	 */
	public get modeTitleKey(): string {
		return this.isAllNearby ? 'allNearby.modeTitle' : 'nav.home'
	}

	/** Label for the swap control — always names the OTHER mode (the destination). */
	public get swapLabelKey(): string {
		return this.isAllNearby
			? 'allNearby.modeToggle.timetable'
			: 'allNearby.modeToggle.allNearby'
	}

	/** Toggle to the opposite view (bound to the header swap control). */
	public toggleMode(): void {
		this.switchMode(this.isAllNearby ? 'timetable' : 'allNearby')
	}

	/**
	 * Switch the dashboard view. My Timetable is never refetched on switch. The
	 * mode change is wrapped in a View Transition so the header title morphs and
	 * the content cross-fades; falls back to an instant swap when the API is
	 * unavailable or the user prefers reduced motion.
	 *
	 * The callback flushes Aurelia's queued DOM writes SYNCHRONOUSLY via runTasks
	 * and returns void — so the transition captures the new state immediately after
	 * the callback. It must NOT return a promise that awaits requestAnimationFrame:
	 * the browser suspends rAF during the transition's snapshot phase, so an
	 * rAF-settled promise never resolves and the transition times out.
	 */
	public switchMode(mode: ViewMode): void {
		if (this.viewMode === mode) return
		const doc = document as Document & {
			startViewTransition?: (cb: () => void) => unknown
		}
		const reduce = window.matchMedia?.(
			'(prefers-reduced-motion: reduce)',
		).matches
		if (!doc.startViewTransition || reduce) {
			this.viewMode = mode
			return
		}
		doc.startViewTransition(() => {
			this.viewMode = mode
			runTasks()
		})
	}

	/**
	 * React to the view switch: entering All Nearby triggers a load (served from
	 * the route-local cache when the filter is unchanged); leaving it aborts any
	 * in-flight request but leaves both caches intact.
	 */
	protected viewModeChanged(mode: ViewMode): void {
		if (mode === 'allNearby') {
			void this.loadAllNearby()
		} else {
			this.allNearbyAbort?.abort()
		}
	}

	/** The date-range sheet emitted a new resolved range + display label. */
	public onRangeChanged(event: CustomEvent<RangeChangedDetail>): void {
		const { label, ...range } = event.detail
		this.allNearbyRange = range
		this.dateChipLabel = label
		if (this.isAllNearby) {
			void this.loadAllNearby()
		}
	}

	/** Open the date-range bottom sheet. */
	public openDateSheet(): void {
		this.dateSheet?.open()
	}

	/** Open the area selector bottom sheet. */
	public openAreaSelector(): void {
		this.areaSelector?.open()
	}

	/**
	 * Area override chosen. Updates route-local state ONLY — never calls
	 * userStore.updateHome(). Triggers a refetch for the new area.
	 */
	public onAreaSelected(code: string): void {
		this.logger.info('All Nearby area override selected', { code })
		this.selectedAreaCode = code
		if (this.isAllNearby) {
			void this.loadAllNearby()
		}
	}

	/**
	 * Resolve the GeoLocation reference point for listByLocation. Uses the
	 * override centroid when set, else the user's home. The FE `User` type does
	 * not carry a centroid, so the home path resolves via geoLocationFromLevel1
	 * over the home level-1 code. Returns null when no area is resolvable.
	 */
	private resolveGeoLocation(): GeoLocationInit | null {
		if (this.selectedAreaCode) {
			return geoLocationFromLevel1(this.selectedAreaCode) ?? null
		}
		const home = this.userStore.currentHome
		if (!home) return null
		return geoLocationFromLevel1(home) ?? null
	}

	/**
	 * Load (or serve from cache) the All Nearby concert list for the current
	 * area + date range. Aborts any in-flight request, dedupes on the
	 * (area, from, to) cache key, and converts the ProximityGroup[] to
	 * DateGroup[] for rendering. Only HOME/NEARBY lanes are populated by the
	 * backend for this path.
	 */
	public async loadAllNearby(): Promise<void> {
		const range = this.allNearbyRange
		if (!range) return

		const geo = this.resolveGeoLocation()
		if (!geo) {
			// No area resolvable (unauthenticated, no home, no override). Prompt the
			// user to choose one rather than firing a location-less request.
			this.allNearbyDateGroups = []
			this.allNearbyError = null
			this.openAreaSelector()
			return
		}

		const key = rangeCacheKey(geo.adminArea, range.from, range.to)
		const cached = this.allNearbyCache.get(key)
		if (cached) {
			this.allNearbyDateGroups = cached
			this.allNearbyError = null
			return
		}

		// Abort a superseded in-flight request before starting a new one.
		this.allNearbyAbort?.abort()
		this.allNearbyAbort = new AbortController()
		const signal = this.allNearbyAbort.signal

		this.allNearbyLoading = true
		this.allNearbyError = null
		try {
			const groups = await this.concertService.listByLocation(
				geo,
				range.from,
				range.to,
				signal,
			)
			if (signal.aborted) return
			// Resolve each card's artist from the concert's own performers (these
			// catalog artists are not in the user's follow set), so names render.
			const dateGroups = this.concertService.toDateGroupsForLocation(groups)
			this.allNearbyCache.set(key, dateGroups)
			this.allNearbyDateGroups = dateGroups
			this.logger.info('All Nearby loaded', {
				adminArea: geo.adminArea,
				groups: dateGroups.length,
			})
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('Failed to load All Nearby', { error: err })
			this.allNearbyError = err
			this.allNearbyDateGroups = []
		} finally {
			if (!signal.aborted) this.allNearbyLoading = false
		}
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	/**
	 * A guest tapped the All Nearby follow CTA. Instead of an immediate OIDC
	 * redirect, surface the persistent sign-up prompt banner — following is the
	 * conversion moment, and the banner keeps the discovered concert in view.
	 */
	public onFollowSignupRequested(): void {
		if (this.isAuthenticated) return
		this.showSignupBanner = true
	}

	public detaching(): void {
		this.resumeRevalidator.unregister(this.revalidate)
		// Remove this route's FAB actions so they never linger after navigation.
		this.fabDisposer?.()
		this.fabDisposer = null
		this.abortController?.abort()
		this.abortController = null
		this.allNearbyAbort?.abort()
		this.allNearbyAbort = null
		// Release the post-signup banner suppression if the user navigates away
		// mid-celebration (before the PostSignupDialog takes over the flag).
		this.promptCoordinator.isPostSignupSurfaceOpen = false
	}
}

/** Structural equality for two calendar dates (year/month/day). */
function sameCalendarDate(a: CalendarDate, b: CalendarDate): boolean {
	return a.year === b.year && a.month === b.month && a.day === b.day
}
