import { I18N } from '@aurelia/i18n'
import { ILogger, INode, resolve } from 'aurelia'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type {
	DateGroup,
	LiveEvent,
} from '../../components/live-highway/live-event'
import type { JourneyStatus } from '../../entities/concert'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { StorageKeys } from '../../constants/storage-keys'
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
		this.loadData()

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

	public loadData(): void {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.loadError = null
		this.isLoading = true
		const signal = this.abortController.signal

		void this.loadDashboardEvents(signal)
			.then((groups) => {
				this.dateGroups = groups
				this.loadError = null
				this.isLoading = false
				this.logger.info('Dashboard loaded', { groups: groups.length })
			})
			.catch((err) => {
				this.isLoading = false
				if ((err as Error).name === 'AbortError') return
				this.logger.error('Failed to load dashboard', { error: err })
				if (this.dateGroups.length === 0) {
					this.loadError = err
				}
			})
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
		this.loadData()

		// If we're in the waiting-for-home sub-state of lane intro, advance to HOME phase
		if (this.laneIntroPhase === 'waiting-for-home') {
			// Resolve prefecture display name for dynamic coach mark text
			this.selectedPrefectureName = this.i18n.tr(
				`userHome.prefectures.${translationKey(code)}`,
			)
			this.laneIntroPhase = 'home'
			this.updateSpotlightForPhase()
		} else if (this.isOnboarding && this.isOnboardingStepDashboard) {
			this.startLaneIntro()
		}
	}

	public onLaneIntroTap(): void {
		this.advanceLaneIntro()
	}

	private async startLaneIntro(): Promise<void> {
		if (!this.isOnboardingStepDashboard) return

		// Wait for data to finish loading before deciding
		while (this.isLoading) {
			await new Promise((r) => setTimeout(r, 100))
		}

		// When no concert data is available, skip lane intro and show celebration
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

		// HOME phase: open Home Selector inline if region not yet set
		if (this.needsRegion) {
			this.laneIntroPhase = 'waiting-for-home'
			this.homeSelector?.open()
			// Spotlight the HOME stage while waiting for selection
			this.onboarding.activateSpotlight(
				'[data-stage="home"]',
				this.i18n.tr('dashboard.laneIntro.homePrompt'),
				undefined,
			)
		} else {
			// Resolve prefecture name for coach mark text (home already set)
			const homeCode = this.guest.home
			if (homeCode) {
				this.selectedPrefectureName = this.i18n.tr(
					`userHome.prefectures.${translationKey(homeCode)}`,
				)
			}
			this.laneIntroPhase = 'home'
			this.logger.info('Lane intro started')
			this.updateSpotlightForPhase()
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
				return '[data-stage="home"]'
			case 'near':
				return '[data-stage="near"]'
			case 'away':
				return '[data-stage="away"]'
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
