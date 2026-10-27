import { I18N } from '@aurelia/i18n'
import { IRouter, type Params, type RouteNode } from '@aurelia/router'
import { ILogger, observable, queueTask, resolve, watch } from 'aurelia'
import { IHistory } from '../../adapter/browser/history'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import type { ArtistFilterBar } from '../../components/artist-filter-bar/artist-filter-bar'
import type { ConcertHighway } from '../../components/live-highway/concert-highway'
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
import type {
	Concert,
	JourneyStatus,
	TimetableAnchor,
} from '../../entities/concert'
import { isJourneyStatus } from '../../entities/ticket-journey'
import {
	type CalendarDate,
	formatDateInput,
	parseDateInput,
	todayCalendarDate,
} from '../../lib/plain-date'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import {
	type FabAction,
	helpAction,
	IFabMenuService,
} from '../../services/fab-menu-service'
import { IFollowStore } from '../../services/follow-store'
import { IOnboardingService } from '../../services/onboarding-service'
import { IPromptCoordinator } from '../../services/prompt-coordinator'
import { IPurchasedTicketStore } from '../../services/purchased-ticket-store'
import { IResumeRevalidator } from '../../services/resume-revalidator'
import { ITicketJourneyStore } from '../../services/ticket-journey-store'
import { IUserStore } from '../../services/user-store'
import { currentLanguage } from '../../util/change-locale'

export class DashboardRoute {
	public dateGroups: DateGroup[] = []
	/** Beam-effect state; @observable so the FAB toggle item reflects it live. */
	@observable public showBeams = false
	@observable public filteredArtistIds: string[] = []
	@observable public filteredStatuses: JourneyStatus[] = []
	/**
	 * The active lower bound sent as `from` to ListFollowed. Defaults to the
	 * client's local date (today onward); a past date widens the timetable into
	 * the past. Restored from the `from` URL query param on load. Unlike the
	 * artist/journey facets (client-side narrowing), changing this re-fetches.
	 */
	@observable public fromDate: CalendarDate = todayCalendarDate()
	public needsRegion = false
	public isLoading = false
	/**
	 * True once a load has settled (succeeded or failed), making "zero groups"
	 * meaningful. The template gates its empty states on this instead of on
	 * `dateGroups.length === 0 && !isLoading`, which cannot tell "not assigned
	 * yet" from "genuinely zero" and so flashes an empty state on re-entry.
	 * Kept separate from `isLoading` deliberately: `isLoading` also guards
	 * refreshInBackground(), so reusing it to drive the skeleton would suppress
	 * the background refresh.
	 */
	public hasSettled = false
	/**
	 * Cached timetable parked by loadData()'s fast path, waiting to be reflected
	 * from the component lifecycle (`binding()`). Never assigned to `dateGroups`
	 * inside the pre-activation `loading()` hook: render state belongs to the
	 * component lifecycle, not to the router's.
	 */
	private pendingCachedGroups: DateGroup[] | null = null
	/** Set once a background refresh has assigned fresher groups, so a later cache reflection cannot clobber them. */
	private freshGroupsLanded = false
	/** Whether the view is attached, so a same-instance reload knows to reflect immediately. */
	private isAttached = false
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
	public celebrationHint = ''
	private celebrationLeadsToDialog = false

	public homeSelector: UserHomeSelector | undefined
	public detailSheet: EventDetailSheet | undefined
	// The filter + help surfaces stay owned by the dashboard (their sheets and
	// bindings are unchanged); only their triggers moved into the FAB launcher.
	public filterBar: ArtistFilterBar | undefined
	public pageHelp: PageHelp | undefined
	/** The My Timetable highway, for saving the fan's scroll place on the way out. */
	public highway: ConcertHighway | undefined
	/**
	 * The date the fan left the timetable on, handed to the highway so it builds
	 * its first window around that date and opens on it. Read in `binding()`.
	 */
	public timetableAnchor: TimetableAnchor | null = null
	/** Disposer for this route's contributed FAB actions; released in detaching(). */
	private fabDisposer: (() => void) | null = null

	/**
	 * Concert id from a `/concerts/:id` deep-link, pending resolution against the
	 * authoritative concert fetch. Null when navigated to a bare `/dashboard` or
	 * during onboarding. Self-clears once resolved so a PWA resume / background
	 * refresh never re-opens the sheet. See resolvePendingDeepLink.
	 */
	private pendingConcertId: string | null = null

	private readonly logger = resolve(ILogger).scopeTo('DashboardRoute')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertService = resolve(IConcertStore)
	private readonly fabMenu = resolve(IFabMenuService)
	private readonly followStore = resolve(IFollowStore)
	private readonly journeyStore = resolve(ITicketJourneyStore)
	private readonly purchasedTickets = resolve(IPurchasedTicketStore)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly promptCoordinator = resolve(IPromptCoordinator)
	private readonly userStore = resolve(IUserStore)
	private readonly storage = resolve(ILocalStorage)
	private readonly history = resolve(IHistory)
	private readonly router = resolve(IRouter)
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
	 * rendered timetable is keyed by `from` too (see timetableKey), so the previous
	 * window is never repainted. The @watch above then syncs the new date to the
	 * URL (or removes the param when back to today).
	 */
	public onDateFilterChanged(event: CustomEvent<CalendarDate>): void {
		const from = event.detail
		if (sameCalendarDate(from, this.fromDate)) return
		this.fromDate = from
		void this.loadData()
	}

	/**
	 * The route's own inputs to a rendered timetable: the home area (it decides
	 * the HOME / NEAR / AWAY lanes) and the date window. The session cache of
	 * the rendered timetable is read only under the same key, so choosing a
	 * home area or another window never paints the timetable built before it.
	 * The follow set is the follow store's input: every follow change, guest or
	 * signed in, invalidates the cache there (it is not known here before the
	 * follow list has loaded).
	 */
	private timetableKey(): string {
		return [
			this.userStore.currentHome ?? '',
			formatDateInput(this.fromDate),
		].join('|')
	}

	public toggleBeams(): void {
		this.showBeams = !this.showBeams
		this.storage.setItem(
			StorageKeys.beamsEnabled,
			this.showBeams ? 'true' : 'false',
		)
	}

	/**
	 * Build this route's FAB launcher action set for the current context. The
	 * first action sits closest to the FAB on the thumb arc: beam, filter, help.
	 * The filter is left out during onboarding (dashboard-artist-filter spec:
	 * "Filter still suppressed during onboarding"); the beam is not.
	 */
	private buildFabActions(): FabAction[] {
		const actions: FabAction[] = [
			{
				id: 'beam',
				labelKey: 'fabMenu.beam',
				icon: 'spotlight',
				kind: 'toggle',
				isOn: () => this.showBeams,
				invoke: () => this.toggleBeams(),
			},
		]
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
		actions.push(helpAction(() => this.pageHelp?.open()))
		return actions
	}

	/**
	 * (Re-)contribute this route's actions to the launcher. Owner-keyed, so an
	 * onboarding transition replaces the set without accumulating (design D2).
	 * Re-runs on the context @watch below and on attach.
	 */
	private registerFabActions(): void {
		this.fabDisposer?.()
		this.fabDisposer = this.fabMenu.register(this, this.buildFabActions())
	}

	/**
	 * Re-register the FAB actions whenever the onboarding state changes, so the
	 * launcher never shows a stale or duplicated set (the filter joins once
	 * onboarding ends).
	 */
	@watch((vm: DashboardRoute) => vm.isOnboarding)
	protected onFabContextChanged(): void {
		this.registerFabActions()
	}

	public async loading(params?: Params, next?: RouteNode): Promise<void> {
		this.showBeams = this.storage.getItem(StorageKeys.beamsEnabled) === 'true'

		// Deep-link target from `/concerts/:id` (e.g. a tapped push notification).
		// Recorded here but resolved only after the authoritative listFollowed
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

		// Fast path: we have a previous render for this user. The groups are parked
		// here rather than assigned, because loadData() is reached from loading() —
		// a PRE-ACTIVATION router hook, which must not assign render state.
		// binding() reflects them instead (see reflectCachedGroups), so the first
		// render already shows the timetable; that render is bounded by the
		// highway's date window, whatever the number of cached dates.
		// The rendered timetable lives in the ConcertStore singleton, which
		// survives DashboardRoute re-instantiation on every navigation, and is
		// read only for the inputs it was built from (timetableKey).
		const cachedDateGroups = this.concertService.peekDateGroups(
			this.timetableKey(),
		)
		if (cachedDateGroups !== null && !this.needsRegion) {
			this.pendingCachedGroups = cachedDateGroups
			this.freshGroupsLanded = false
			// Already attached (a same-instance reload, e.g. the date filter) — there
			// is no upcoming activation to reflect on, so do it now.
			if (this.isAttached) this.reflectCachedGroups()
			void this.refreshInBackground()
			return
		}

		// Cold load: first visit, or home area, date window or follows changed.
		this.pendingCachedGroups = null
		this.hasSettled = false
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

		// A settled load — success or failure — is what makes "zero groups" mean
		// "genuinely empty" rather than "not assigned yet". The template gates its
		// empty states on this, never on `dateGroups.length` alone. An aborted load
		// returned early above and deliberately leaves this false.
		this.hasSettled = true
	}

	/**
	 * Reflect the cached timetable parked by loadData()'s fast path. Runs from the
	 * component lifecycle, before the first render (`binding()`), so re-entry paints
	 * the cached timetable directly instead of a skeleton and then the content.
	 * The highway builds only a window of it, around `timetableAnchor`, and
	 * positions itself there in its own `attached()` — nothing is forced to flush.
	 *
	 * Skipped when the background refresh already assigned fresher groups: the
	 * refresh is kicked off without awaiting, so on a fast connection — and always
	 * with a microtask-resolving test double — it can settle before this runs, and
	 * writing the cache afterwards would replace fresh data with stale.
	 */
	private reflectCachedGroups(): void {
		const cached = this.pendingCachedGroups
		this.pendingCachedGroups = null
		if (cached === null || this.freshGroupsLanded) return

		this.dateGroups = cached
		this.hasSettled = true
		this.timetableLoaded = true
	}

	/**
	 * Resolve a pending `/concerts/:id` deep-link against the authoritative concert
	 * list once it has settled — from the cold-load await or the background refresh,
	 * never off the cache first-paint.
	 *
	 * On match: derive the artist filter from the concert, then open the detail
	 * sheet in a task queued behind that filter's URL write, so the sheet's pushed
	 * `/concerts/:id` URL is the final history entry and wins while the sheet is
	 * open (two URL writers race — the sheet must win; the filter URL applies
	 * after close). On no match
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

		// A first-party concert has its own Event page and never opens the
		// sheet; an older `/concerts/:id` link to one is forwarded there.
		if (concert.isFirstParty) {
			void this.openEventPage(concert, 'replace')
			return
		}

		this.filteredArtistIds = [concert.artistId]
		// Open the sheet as a queued task rather than after a synchronous flush.
		// The filter's URL write (`syncFilterUrl`) is queued by its @watch when
		// the filter is assigned, and the queue runs in order, so the sheet's
		// pushed `/concerts/:id` still lands after it and wins while the sheet
		// is open. A `runTasks()` here would also flush the filtered
		// timetable's render, and on a slow device that exceeds Aurelia's
		// 100 ms synchronous budget: the flush throws "Potential deadlock"
		// and drops every queued task — the render included.
		queueTask(() => this.detailSheet?.open(concert))
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
		forceConcerts = false,
	): Promise<DateGroup[]> {
		this.logger.info('Loading dashboard events')
		const key = this.timetableKey()

		const [artistMap, groups, journeyMap, purchasedMap] = await Promise.all([
			this.followStore.getFollowedArtistMap(signal),
			forceConcerts
				? this.concertService.revalidateFollower(this.fromDate)
				: this.concertService.listFollowed(this.fromDate, signal),
			this.fetchJourneyMap(signal),
			this.fetchPurchasedMap(signal),
		])

		if (groups.length === 0) {
			this.logger.info('No concert groups returned')
			// Cache the empty result so re-entry shows the empty state immediately
			// rather than a spinner, then refreshes in the background.
			this.concertService.setDateGroups(key, [])
			return []
		}

		const result = this.concertService.toDateGroups(
			groups,
			artistMap,
			journeyMap,
			purchasedMap,
		)
		// Persist the rendered output in the singleton so the next DashboardRoute
		// instance (re-created on every navigation) paints instantly on re-entry.
		this.concertService.setDateGroups(key, result)
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

	private async fetchPurchasedMap(
		signal?: AbortSignal,
	): Promise<Map<string, number>> {
		// One TicketService.List per dashboard load drives the first-party purchased
		// badges. Like the journey map, a failure must not blank the dashboard:
		// the cards then show no purchased badge.
		try {
			return await this.purchasedTickets.load(signal)
		} catch (err) {
			this.logger.warn('Ticket fetch failed, continuing without badges', {
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
				// A first-party card shows the purchased badge, not a journey.
				if (concert.id && !concert.isFirstParty) {
					concert.journeyStatus = map.get(concert.id)
				}
			}
		}
	}

	/**
	 * PWA-resume callback: force a refetch of the concert list (bypassing the
	 * 24h cache, which would otherwise hand back the cached value) and swap the
	 * fresh result in place — no spinner, no scroll reset, no document reload.
	 */
	public readonly revalidate = (): void => {
		void this.refreshInBackground({ force: true })
	}

	/**
	 * Re-derive the timetable in the background and swap it in place. With
	 * `force`, the concert list is refetched regardless of the cache's staleness;
	 * without it, the cached list is read (stale-while-revalidate).
	 */
	private async refreshInBackground(
		opts: { force?: boolean } = {},
	): Promise<void> {
		if (this.needsRegion || this.isLoading) return
		const signal = this.abortController?.signal
		try {
			const fresh = await this.loadDashboardEvents(signal, opts.force)
			if (signal?.aborted) return
			this.dateGroups = fresh
			// Claim the render state so a cache reflection that has not run yet can
			// never overwrite this fresher result with the stale cache.
			this.freshGroupsLanded = true
			this.pendingCachedGroups = null
			this.hasSettled = true
			// Fast path: this background fetch is the authoritative list. Resolve any
			// pending `/concerts/:id` deep-link now that fresh data has settled.
			this.resolvePendingDeepLink()
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.warn('Dashboard background refresh failed', { error: err })
		}
	}

	/**
	 * Reflect the cached timetable before the first render. `binding()` is a
	 * component-lifecycle hook that runs after the router's `loading()` and
	 * before this view's own bindings bind — `bound()` would be too late, since
	 * the highway's `date-groups` and `initial-anchor` bindings sit directly in
	 * this view and would hand it the empty, anchorless values first — so the
	 * highway builds its first window from the cache and around the remembered
	 * date.
	 */
	public binding(): void {
		this.timetableAnchor = this.concertService.timetableAnchor(
			this.timetableKey(),
		)
		this.reflectCachedGroups()
	}

	public attached(): void {
		this.isAttached = true

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
			this.celebrationSubMessage = this.i18n.tr('dashboard.celebration.chasing')
			this.celebrationHint = ''
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
		// Celebrate only what the fan can see: with no follow the guest empty
		// state guides, and with follows but no concert the generic empty state
		// does. The completion latch keeps its own condition (≥1 follow).
		const artists = this.followStore.followedCount
		const concerts = this.countLoadedConcerts()
		if (artists < 1 || concerts < 1) return
		this.celebrationConfetti = false
		this.celebrationMessage = this.i18n.tr('dashboard.celebration.complete')
		this.celebrationSubMessage = this.i18n.tr('dashboard.celebration.found', {
			artists,
			concerts,
		})
		this.celebrationHint = this.i18n.tr('dashboard.celebration.tapToView')
		this.celebrationLeadsToDialog = false
		this.showCelebration = true
	}

	/** Distinct concerts across every lane of the loaded date groups. */
	private countLoadedConcerts(): number {
		const ids = new Set<string>()
		for (const group of this.dateGroups) {
			for (const concert of [...group.home, ...group.nearby, ...group.away]) {
				ids.add(concert.id)
			}
		}
		return ids.size
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
	 * progress row and page-help auto-open still apply until the guest follows an
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
		// A first-party concert opens its public Event page instead of the
		// sheet. Leaving the route saves the timetable anchor (unloading), so
		// the back control returns to the date the fan left.
		if (event.detail.event.isFirstParty) {
			void this.openEventPage(event.detail.event)
			return
		}
		// Tag the source as the dashboard so concert.detail.viewed events from
		// the dashboard concert list are attributable to that surface in PostHog.
		// The timetable shows followed artists only, so no follow action.
		this.detailSheet?.open(event.detail.event, 'dashboard', false)
	}

	private async openEventPage(
		concert: LiveEvent,
		historyStrategy: 'push' | 'replace' = 'push',
	): Promise<void> {
		await this.router.load(`/events/${concert.id}`, { historyStrategy })
	}

	public onSignupRequested(): void {
		this.errorBoundary.addBreadcrumb('action', 'start_sign_up')
		this.authService.signUp({
			uiLocales: currentLanguage(this.i18n),
			source: 'dashboard_prompt',
		})
	}

	/**
	 * Remember where the fan left the timetable. `unloading` is the route
	 * lifecycle's "save state" hook and runs while the view is still in the DOM,
	 * so the scroll container can still be read — by `detaching()` the position is
	 * already gone. Navigation-scoped, which is exactly the lifetime this memory
	 * needs: it should survive a trip to another tab, not a reload.
	 */
	public unloading(): void {
		if (this.highway) {
			this.concertService.saveTimetableAnchor(
				this.timetableKey(),
				this.highway.scrollAnchor,
			)
		}
	}

	public detaching(): void {
		this.isAttached = false
		// Drop any cache reflection that never ran, so it cannot write into a
		// torn-down route (mirrors the abortController discipline below).
		this.pendingCachedGroups = null
		this.resumeRevalidator.unregister(this.revalidate)
		// Remove this route's FAB actions so they never linger after navigation.
		this.fabDisposer?.()
		this.fabDisposer = null
		this.abortController?.abort()
		this.abortController = null
		// Release the post-signup banner suppression if the user navigates away
		// mid-celebration (before the PostSignupDialog takes over the flag).
		this.promptCoordinator.isPostSignupSurfaceOpen = false
	}
}

/** Structural equality for two calendar dates (year/month/day). */
function sameCalendarDate(a: CalendarDate, b: CalendarDate): boolean {
	return a.year === b.year && a.month === b.month && a.day === b.day
}
