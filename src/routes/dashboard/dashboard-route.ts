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
import { IConcertService } from '../../services/concert-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import { IGuestService } from '../../services/guest-service'
import { INavDimmingService } from '../../services/nav-dimming-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { ITicketJourneyService } from '../../services/ticket-journey-service'
import { IUserService } from '../../services/user-service'

export class DashboardRoute {
	public dateGroups: DateGroup[] = []
	@observable public filteredArtistIds: string[] = []
	public needsRegion = false
	public isLoading = false
	public loadError: unknown = null
	public showSignupBanner = false
	public showPostSignupDialog = false

	public homeSelector: UserHomeSelector | undefined
	public detailSheet: EventDetailSheet | undefined

	private readonly logger = resolve(ILogger).scopeTo('DashboardRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertService = resolve(IConcertService)
	private readonly followService = resolve(IFollowServiceClient)
	private readonly journeyService = resolve(ITicketJourneyService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly guest = resolve(IGuestService)
	private readonly userService = resolve(IUserService)
	private readonly navDimming = resolve(INavDimmingService)
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
		return this.followService.followedArtists
	}

	public get filteredDateGroups(): DateGroup[] {
		if (this.filteredArtistIds.length === 0) return this.dateGroups
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
			this.followService.getFollowedArtistMap(signal),
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

		// PostSignupDialog: show once after first-time signup.
		// Checked in attached() so child BottomSheet is in the DOM
		// and showPopover() can succeed.
		if (this.storage.getItem(StorageKeys.postSignupShown) === 'pending') {
			this.storage.removeItem(StorageKeys.postSignupShown)
			this.showPostSignupDialog = true
		}
	}

	public onHomeSelected(code: string): void {
		this.logger.info('Home area configured', { code })
		this.needsRegion = false
		if (!this.authService.isAuthenticated) {
			this.guest.setHome(code)
		}
		void this.loadData()
	}

	public onEventSelected(event: CustomEvent<{ event: LiveEvent }>): void {
		this.detailSheet?.open(event.detail.event)
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	public onBannerDismissed(): void {
		this.showSignupBanner = false
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
		this.navDimming.setDimmed(false)
	}
}
