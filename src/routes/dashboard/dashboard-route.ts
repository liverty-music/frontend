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
import { ITicketJourneyService } from '../../services/ticket-journey-service'
import { IUserStore } from '../../services/user-store'

export class DashboardRoute {
	public dateGroups: DateGroup[] = []
	@observable public filteredArtistIds: string[] = []
	@observable public filteredStatuses: JourneyStatus[] = []
	public needsRegion = false
	public isLoading = false
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
	private readonly journeyService = resolve(ITicketJourneyService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly userStore = resolve(IUserStore)
	private readonly storage = resolve(ILocalStorage)
	private readonly history = resolve(IHistory)
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

		// When region is set, await data so stage headers exist by attached().
		// When needsRegion, data can't load yet (API returns [] without homeCode),
		// so fire-and-forget — the @watch handler will react when data arrives.
		if (this.needsRegion) {
			void this.loadData()
		} else {
			await this.loadData()
		}

		// Show signup banner for unauthenticated users who completed onboarding
		if (!this.authService.isAuthenticated && this.onboarding.isCompleted) {
			this.showSignupBanner = true
		}
	}

	public async loadData(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.loadError = null
		this.isLoading = true
		const signal = this.abortController.signal

		try {
			this.dateGroups = await this.loadDashboardEvents(signal)
			this.loadError = null
			this.logger.info('Dashboard loaded', {
				groups: this.dateGroups.length,
			})
		} catch (err) {
			if ((err as Error).name === 'AbortError') return
			this.logger.error('Failed to load dashboard', { error: err })
			if (this.dateGroups.length === 0) {
				this.loadError = err
			}
		} finally {
			this.isLoading = false
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
			return []
		}

		return this.concertService.toDateGroups(groups, artistMap, journeyMap)
	}

	private async fetchJourneyMap(
		signal?: AbortSignal,
	): Promise<Map<string, JourneyStatus>> {
		if (!this.authService.isAuthenticated) {
			return new Map()
		}
		try {
			return await this.journeyService.listByUser(signal)
		} catch (err) {
			this.logger.warn('Journey fetch failed, continuing without statuses', {
				error: err,
			})
			return new Map()
		}
	}

	public attached(): void {
		// Open the home selector when the user has no region set.
		// Done in attached() so the BottomSheet is in the DOM and showPopover() works.
		if (this.needsRegion) {
			this.homeSelector?.open()
		}

		// Run the celebration + completion-latch decisions once the timetable is
		// real. While needsRegion is true the home-selector is open and the
		// timetable is blurred, so this is deferred to onHomeSelected(); otherwise
		// data was already awaited in loading().
		if (!this.needsRegion) {
			this.onTimetableReady()
		}
	}

	public async onHomeSelected(code: string): Promise<void> {
		this.logger.info('Home area configured', { code })
		this.needsRegion = false
		if (!this.authService.isAuthenticated) {
			this.userStore.setGuestHome(code)
		}
		await this.loadData()
		// Timetable is now real (region was just selected) — run the deferred
		// celebration + completion-latch decisions.
		this.onTimetableReady()
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
		// The dashboard concert list IS the recommendation feed — tag the source
		// so FE click events can be joined to the BE impression signal in PostHog.
		this.detailSheet?.open(event.detail.event, 'recommendation')
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
	}
}
