import { I18N } from '@aurelia/i18n'
import { queueTask } from '@aurelia/runtime'
import { watch } from '@aurelia/runtime-html'
import { ILogger, INode, resolve } from 'aurelia'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type {
	DateGroup,
	LiveEvent,
} from '../../components/live-highway/live-event'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { StorageKeys } from '../../constants/storage-keys'
import type { JourneyStatus } from '../../entities/concert'
import { translationKey } from '../../entities/user'
import { IAuthService } from '../../services/auth-service'
import { IConcertService } from '../../services/concert-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import { IGuestService } from '../../services/guest-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { ITicketJourneyService } from '../../services/ticket-journey-service'
import { IUserService } from '../../services/user-service'

/** Lane intro phases — no 'card' phase; 'waiting-for-home' is a sub-state of 'home' */
export type LaneIntroPhase =
	| 'home'
	| 'waiting-for-home'
	| 'near'
	| 'away'
	| 'done'

export class DashboardRoute {
	private static get celebrationShown(): boolean {
		return localStorage.getItem(StorageKeys.celebrationShown) === '1'
	}

	private static set celebrationShown(value: boolean) {
		if (value) {
			localStorage.setItem(StorageKeys.celebrationShown, '1')
		} else {
			localStorage.removeItem(StorageKeys.celebrationShown)
		}
	}

	public dateGroups: DateGroup[] = []
	public needsRegion = false
	public isLoading = false
	public loadError: unknown = null
	public showCelebration = false
	public laneIntroPhase: LaneIntroPhase = 'done'
	public showSignupBanner = false
	public showPostSignupDialog = false
	/** Prefecture name resolved after Home Selector selection, used for dynamic coach mark text. */
	public selectedPrefectureName = ''

	public homeSelector: UserHomeSelector | undefined
	public detailSheet: EventDetailSheet | undefined

	private readonly element = resolve(INode) as HTMLElement
	private readonly logger = resolve(ILogger).scopeTo('DashboardRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly concertService = resolve(IConcertService)
	private readonly followService = resolve(IFollowServiceClient)
	private readonly journeyService = resolve(ITicketJourneyService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly guest = resolve(IGuestService)
	private readonly userService = resolve(IUserService)
	private abortController: AbortController | null = null

	public get isOnboardingStepDashboard(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DASHBOARD
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	public async loading(): Promise<void> {
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

		// PostSignupDialog: show once after first-time signup
		if (localStorage.getItem(StorageKeys.postSignupShown) === 'pending') {
			localStorage.removeItem(StorageKeys.postSignupShown)
			this.showPostSignupDialog = true
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
		if (this.isOnboardingStepDashboard) {
			this.startLaneIntro()
		}
	}

	/**
	 * Called when Celebration Overlay opens.
	 * Advances the onboarding step to MY_ARTISTS — this is the controlled
	 * moment before free exploration begins.
	 */
	public onCelebrationOpen(): void {
		this.onboarding.setStep(OnboardingStep.MY_ARTISTS)
		this.logger.info('Celebration opened: advancing step to MY_ARTISTS')
	}

	/**
	 * Called when Celebration Overlay is dismissed (tap anywhere).
	 * Deactivates blocker divs, releases scroll lock, restores nav tabs.
	 */
	public onCelebrationDismissed(): void {
		this.showCelebration = false
		this.logger.info('Celebration dismissed: entering free exploration')
		this.onboarding.deactivateSpotlight()
		this.setNavTabsDimmed(false)
	}

	public onHomeSelected(code: string): void {
		this.logger.info('Home area configured', { code })
		this.needsRegion = false
		if (!this.authService.isAuthenticated) {
			this.guest.setHome(code)
		}
		void this.loadData()

		// If we're in the waiting-for-home sub-state of lane intro, advance to HOME phase.
		// Spotlight activation is deferred — the @watch on dateGroups.length will trigger
		// updateSpotlightForPhase() via queueTask after data loads and DOM renders.
		if (this.laneIntroPhase === 'waiting-for-home') {
			this.selectedPrefectureName = this.i18n.tr(
				`userHome.prefectures.${translationKey(code)}`,
			)
			this.laneIntroPhase = 'home'
		} else if (this.isOnboarding && this.isOnboardingStepDashboard) {
			this.startLaneIntro()
		}
	}

	public onLaneIntroTap(): void {
		this.advanceLaneIntro()
	}

	private startLaneIntro(): void {
		if (!this.isOnboardingStepDashboard) return

		// When region is not set, open Home Selector directly.
		// The coach mark cannot be shown simultaneously because the bottom-sheet
		// overlaps the spotlight tooltip. HOME STAGE context is conveyed via the
		// Home Selector's own description text instead.
		// The @watch on dateGroups.length will activate spotlight after data loads.
		if (this.needsRegion) {
			this.setNavTabsDimmed(true)
			this.laneIntroPhase = 'waiting-for-home'
			this.homeSelector?.open()
			return
		}

		// Data was awaited in loading(), so dateGroups is ready.
		// If empty, skip lane intro and show celebration.
		if (this.dateGroups.length === 0) {
			this.logger.warn('No concert data available, skipping lane intro')
			this.laneIntroPhase = 'done'
			if (!DashboardRoute.celebrationShown) {
				this.showCelebration = true
				DashboardRoute.celebrationShown = true
			}
			return
		}

		this.setNavTabsDimmed(true)

		// Resolve prefecture name for coach mark text (home already set)
		const homeCode = this.guest.home
		if (homeCode) {
			this.selectedPrefectureName = this.i18n.tr(
				`userHome.prefectures.${translationKey(homeCode)}`,
			)
		}
		this.laneIntroPhase = 'home'
		this.logger.info('Lane intro started')
		// Defer spotlight to next render cycle so stage headers are in DOM
		queueTask(() => this.updateSpotlightForPhase())
	}

	/**
	 * Reactive spotlight trigger: fires when dateGroups transitions from
	 * empty to non-empty after Home Selector selection + data reload.
	 */
	@watch((vm: DashboardRoute) => vm.dateGroups.length)
	private onDateGroupsChanged(newLen: number): void {
		if (
			newLen > 0 &&
			this.laneIntroPhase === 'home' &&
			this.isOnboardingStepDashboard
		) {
			queueTask(() => this.updateSpotlightForPhase())
		}
	}

	/**
	 * Handles the edge case where loadData() completes with 0 results
	 * after Home Selector selection. In this case dateGroups stays at
	 * length 0 (no @watch trigger), so we watch isLoading instead.
	 */
	@watch((vm: DashboardRoute) => vm.isLoading)
	private onLoadingChanged(loading: boolean): void {
		if (
			loading ||
			this.laneIntroPhase !== 'home' ||
			!this.isOnboardingStepDashboard
		) {
			return
		}
		if (this.dateGroups.length === 0) {
			this.logger.warn('No concert data available, skipping lane intro')
			this.laneIntroPhase = 'done'
			if (!DashboardRoute.celebrationShown) {
				this.showCelebration = true
				DashboardRoute.celebrationShown = true
			}
			this.setNavTabsDimmed(false)
		}
	}

	private advanceLaneIntro(): void {
		if (this.laneIntroPhase === 'waiting-for-home') return

		const phases: LaneIntroPhase[] = ['home', 'near', 'away', 'done']
		const currentIdx = phases.indexOf(this.laneIntroPhase)
		if (currentIdx < 0 || currentIdx >= phases.length - 1) {
			this.completeLaneIntro()
			return
		}

		const nextPhase = phases[currentIdx + 1]
		this.laneIntroPhase = nextPhase
		this.logger.info('Lane intro advanced', { phase: this.laneIntroPhase })

		if (this.laneIntroPhase === 'done') {
			this.completeLaneIntro()
		} else {
			this.updateSpotlightForPhase()
		}
	}

	private completeLaneIntro(): void {
		this.laneIntroPhase = 'done'
		this.onboarding.deactivateSpotlight()
		if (!DashboardRoute.celebrationShown) {
			this.logger.info('Lane intro completed, showing celebration')
			this.showCelebration = true
			DashboardRoute.celebrationShown = true
		} else {
			this.logger.info('Lane intro completed, celebration already shown')
			this.setNavTabsDimmed(false)
		}
	}

	private updateSpotlightForPhase(): void {
		const selector = this.laneIntroSelector
		const message = this.laneIntroMessage
		if (!selector) return
		this.onboarding.activateSpotlight(selector, message, () =>
			this.onLaneIntroTap(),
		)
	}

	/** Dim/undim nav tabs during Lane Intro to guide focus. */
	private setNavTabsDimmed(dimmed: boolean): void {
		const navItems = this.element
			.closest('body')
			?.querySelectorAll<HTMLElement>('[data-nav]')
		if (!navItems) return
		for (const item of navItems) {
			if (dimmed) {
				item.style.setProperty('opacity', '0.3')
				item.setAttribute('aria-disabled', 'true')
			} else {
				item.style.removeProperty('opacity')
				item.removeAttribute('aria-disabled')
			}
		}
	}

	public get laneIntroSelector(): string {
		switch (this.laneIntroPhase) {
			case 'home':
			case 'waiting-for-home':
				return 'concert-highway [data-stage="home"]'
			case 'near':
				return 'concert-highway [data-stage="near"]'
			case 'away':
				return 'concert-highway [data-stage="away"]'
			default:
				return ''
		}
	}

	public get laneIntroMessage(): string {
		switch (this.laneIntroPhase) {
			case 'home':
				return this.selectedPrefectureName
					? this.i18n.tr('dashboard.laneIntro.home', {
							prefecture: this.selectedPrefectureName,
						})
					: this.i18n.tr('dashboard.laneIntro.homePrompt')
			case 'waiting-for-home':
				return this.i18n.tr('dashboard.laneIntro.homePrompt')
			case 'near':
				return this.i18n.tr('dashboard.laneIntro.near')
			case 'away':
				return this.i18n.tr('dashboard.laneIntro.away')
			default:
				return ''
		}
	}

	public get isLaneIntroActive(): boolean {
		return this.laneIntroPhase !== 'done'
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
		this.setNavTabsDimmed(false)
	}
}
