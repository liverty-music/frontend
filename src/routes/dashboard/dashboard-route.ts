import { I18N } from '@aurelia/i18n'
import type { Params, RouteNode } from '@aurelia/router'
import { ILogger, observable, resolve } from 'aurelia'
import { IHistory } from '../../adapter/browser/history'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type {
	DateGroup,
	LiveEvent,
} from '../../components/live-highway/live-event'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { StorageKeys } from '../../constants/storage-keys'
import type { Artist } from '../../entities/artist'
import type { JourneyStatus } from '../../entities/concert'
import { IAuthService } from '../../services/auth-service'
import { IConcertStore } from '../../services/concert-store'
import { IFollowStore } from '../../services/follow-store'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { ITicketJourneyService } from '../../services/ticket-journey-service'
import { IUserService } from '../../services/user-service'
import { IUserStore } from '../../services/user-store'

export class DashboardRoute {
	public dateGroups: DateGroup[] = []
	@observable public filteredArtistIds: string[] = []
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
	private readonly userService = resolve(IUserService)
	private readonly storage = resolve(ILocalStorage)
	private readonly history = resolve(IHistory)
	private abortController: AbortController | null = null

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	public get followedArtists(): Artist[] {
		return this.followStore.followedArtists
	}

	public get filteredDateGroups(): DateGroup[] {
		// Always strip blank-artistId concerts before rendering. Post-v0.41.0
		// `concertFrom` returns `artistId: ''` when no performer resolved
		// against the user's artistMap (ID-namespace mismatch, schema-skew
		// rollout window) — those rows have no usable artist context and
		// would render as ghost cards with empty names. The active-filter
		// branch below already excludes them naturally (Set.has('') is
		// false); apply the same rule to the unfiltered branch so the
		// authenticated dashboard never surfaces ghost cards.
		const stripBlank = (g: DateGroup): DateGroup => ({
			...g,
			home: g.home.filter((c) => c.artistId),
			nearby: g.nearby.filter((c) => c.artistId),
			away: g.away.filter((c) => c.artistId),
		})
		if (this.filteredArtistIds.length === 0) {
			return this.dateGroups
				.map(stripBlank)
				.filter((g) => g.home.length + g.nearby.length + g.away.length > 0)
		}
		const ids = new Set(this.filteredArtistIds)
		return this.dateGroups
			.map((g) => ({
				...g,
				home: g.home.filter((c) => ids.has(c.artistId)),
				nearby: g.nearby.filter((c) => ids.has(c.artistId)),
				away: g.away.filter((c) => ids.has(c.artistId)),
			}))
			.filter((g) => g.home.length + g.nearby.length + g.away.length > 0)
	}

	public filteredArtistIdsChanged(): void {
		this.updateFilterUrl()
	}

	private updateFilterUrl(): void {
		const url =
			this.filteredArtistIds.length > 0
				? `/dashboard?artists=${this.filteredArtistIds.join(',')}`
				: '/dashboard'
		this.history.replaceState(null, '', url)
	}

	public async loading(_params?: Params, next?: RouteNode): Promise<void> {
		// Restore artist filter from URL query param (ignored during onboarding)
		if (!this.isOnboarding && next) {
			const raw = next.queryParams.get('artists')
			this.filteredArtistIds = raw ? raw.split(',').filter(Boolean) : []
		}

		if (this.authService.isAuthenticated) {
			this.needsRegion = !this.userService.current?.home
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

		// Advance onboarding step: DASHBOARD → MY_ARTISTS.
		// The lane introduction sequence was removed; visiting the dashboard is now
		// sufficient to complete this step and allow free navigation.
		if (this.onboarding.currentStep === OnboardingStep.DASHBOARD) {
			this.onboarding.setStep(OnboardingStep.MY_ARTISTS)
			this.logger.info('Dashboard step completed: advancing to MY_ARTISTS')
		}

		// Celebrate once the timetable is real. While needsRegion is true the
		// home-selector is open and the timetable is blurred, so defer to
		// onHomeSelected(); otherwise data was already awaited in loading().
		// The post-signup tier opens PostSignupDialog on dismissal (see
		// maybeCelebrate / onCelebrationDismissed).
		if (!this.needsRegion) {
			this.maybeCelebrate()
		}
	}

	public async onHomeSelected(code: string): Promise<void> {
		this.logger.info('Home area configured', { code })
		this.needsRegion = false
		if (!this.authService.isAuthenticated) {
			this.userStore.setGuestHome(code)
		}
		await this.loadData()
		// Timetable is now real — run the celebration that was deferred while the
		// region was unset.
		this.maybeCelebrate()
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
		this.storage.setItem(StorageKeys.celebrationShown, '1')
		this.celebrationConfetti = false
		this.celebrationMessage = this.i18n.tr('dashboard.celebration.complete')
		this.celebrationSubMessage = this.i18n.tr('dashboard.celebration.explore')
		this.celebrationLeadsToDialog = false
		this.showCelebration = true
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
