import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import type { DateGroup } from '../components/live-highway/live-event'
import { UserHomeSelector } from '../components/user-home-selector/user-home-selector'
import { StorageKeys } from '../constants/storage-keys'
import { IAuthService } from '../services/auth-service'
import { IDashboardService } from '../services/dashboard-service'
import { ILocalArtistClient } from '../services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../services/onboarding-service'
import { IUserService } from '../services/user-service'

export type LaneIntroPhase = 'home' | 'near' | 'away' | 'card' | 'done'

export class Dashboard {
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
	public loadError: unknown = null
	public isStale = false
	public showCelebration = false
	public laneIntroPhase: LaneIntroPhase = 'done'
	public showSignupBanner = false

	public homeSelector!: UserHomeSelector

	private readonly logger = resolve(ILogger).scopeTo('Dashboard')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly dashboardService = resolve(IDashboardService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly userService = resolve(IUserService)
	private readonly router = resolve(IRouter)
	private abortController: AbortController | null = null
	private laneIntroTimer: ReturnType<typeof setTimeout> | null = null

	public dataPromise: Promise<DateGroup[]> | null = null

	public get isTutorialStep3(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DASHBOARD
	}

	public get isTutorialStep4(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DETAIL
	}

	public get isOnboarding(): boolean {
		return this.onboarding.isOnboarding
	}

	public get isAuthenticated(): boolean {
		return this.authService.isAuthenticated
	}

	public async loading(): Promise<void> {
		if (this.authService.isAuthenticated) {
			try {
				const resp = await this.userService.client.get({})
				this.needsRegion = !resp.user?.home
			} catch (err) {
				this.logger.warn(
					'Failed to fetch user home, falling back to localStorage',
					{ error: err },
				)
				this.needsRegion = !UserHomeSelector.getStoredHome()
			}
		} else {
			this.needsRegion = !UserHomeSelector.getStoredHome()
		}
		this.showCelebration =
			this.onboarding.currentStep === OnboardingStep.DASHBOARD &&
			!Dashboard.celebrationShown
		if (this.showCelebration) {
			Dashboard.celebrationShown = true
		}
		this.loadData()

		// When returning to step 3 with celebration and region already resolved,
		// resume the lane intro (e.g. page reload during onboarding)
		if (this.isTutorialStep3 && !this.showCelebration && !this.needsRegion) {
			this.startLaneIntro()
		}

		// Show signup banner for unauthenticated users who completed onboarding
		if (!this.authService.isAuthenticated && this.onboarding.isCompleted) {
			this.showSignupBanner = true
		}

		// Resume step 4 spotlight after reload: re-activate My Artists tab spotlight
		// so the user can proceed. bringSpotlightToFront ensures the coach mark
		// renders above the detail sheet in the top-layer LIFO stack.
		if (this.isTutorialStep4) {
			this.onboarding.activateSpotlight(
				'[data-nav-my-artists]',
				this.i18n.tr('dashboard.coachMark.viewArtists'),
				() => this.onTutorialMyArtistsTapped(),
			)
			this.onboarding.bringSpotlightToFront()
		}
	}

	public loadData(): void {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.loadError = null
		this.isStale = false

		this.dataPromise = this.dashboardService
			.loadDashboardEvents(this.abortController.signal)
			.then((groups) => {
				this.dateGroups = groups
				this.loadError = null
				this.logger.info('Dashboard loaded', { groups: groups.length })
				return groups
			})
			.catch((err) => {
				if ((err as Error).name === 'AbortError') {
					throw err
				}
				this.loadError = err
				this.logger.error('Failed to load dashboard', { error: err })
				// If we have previous data, mark as stale instead of clearing
				if (this.dateGroups.length > 0) {
					this.isStale = true
				}
				throw err
			})
	}

	public retry(): void {
		this.loadData()
	}

	public attached(): void {
		if (this.needsRegion && !this.showCelebration) {
			this.homeSelector.open()
		}
	}

	public onCelebrationComplete(): void {
		this.showCelebration = false
		this.logger.info('Celebration complete')
		if (this.needsRegion) {
			this.homeSelector.open()
		} else {
			this.startLaneIntro()
		}
	}

	public onHomeSelected(code: string): void {
		this.logger.info('Home area configured', { code })
		this.needsRegion = false
		this.loadData()
		if (this.isOnboarding) {
			this.localClient.setHome(code)
			this.startLaneIntro()
		}
	}

	public onLaneIntroTap(): void {
		this.advanceLaneIntro()
	}

	private async startLaneIntro(): Promise<void> {
		if (!this.isTutorialStep3) return

		// Wait for data to finish loading before deciding
		if (this.dataPromise) {
			try {
				await this.dataPromise
			} catch {
				// Data load failed — proceed with whatever we have
			}
		}

		// When no concert data is available, skip lane intro entirely
		if (this.dateGroups.length === 0) {
			this.logger.warn('No concert data available, skipping lane intro')
			this.laneIntroPhase = 'done'
			this.skipToMyArtists()
			return
		}

		this.laneIntroPhase = 'home'
		this.logger.info('Lane intro started')
		this.updateSpotlightForPhase()
		this.scheduleLaneIntroAdvance()
	}

	private advanceLaneIntro(): void {
		if (this.laneIntroTimer) {
			clearTimeout(this.laneIntroTimer)
			this.laneIntroTimer = null
		}

		const phases: LaneIntroPhase[] = ['home', 'near', 'away', 'card', 'done']
		const currentIdx = phases.indexOf(this.laneIntroPhase)
		if (currentIdx < 0 || currentIdx >= phases.length - 1) {
			this.laneIntroPhase = 'done'
			return
		}

		let nextPhase = phases[currentIdx + 1]

		// Skip card phase when no concert data is available
		if (nextPhase === 'card' && this.dateGroups.length === 0) {
			this.logger.warn('No concert cards available, skipping card phase')
			nextPhase = 'done'
			this.laneIntroPhase = nextPhase
			this.onboarding.deactivateSpotlight()
			this.skipToMyArtists()
			return
		}

		this.laneIntroPhase = nextPhase
		this.logger.info('Lane intro advanced', { phase: this.laneIntroPhase })
		this.updateSpotlightForPhase()

		if (this.laneIntroPhase !== 'done' && this.laneIntroPhase !== 'card') {
			this.scheduleLaneIntroAdvance()
		}
	}

	/**
	 * Skip from lane intro directly to Step 4 (My Artists tab spotlight)
	 * when no concert cards are available.
	 */
	private skipToMyArtists(): void {
		this.onboarding.setStep(OnboardingStep.DETAIL)
		this.onboarding.activateSpotlight(
			'[data-nav-my-artists]',
			this.i18n.tr('dashboard.coachMark.viewArtists'),
			() => this.onTutorialMyArtistsTapped(),
		)
	}

	private updateSpotlightForPhase(): void {
		const selector = this.laneIntroSelector
		const message = this.laneIntroMessage
		if (!selector) return

		const onTap =
			this.laneIntroPhase === 'card'
				? () => this.onTutorialCardTapped()
				: () => this.onLaneIntroTap()

		this.onboarding.activateSpotlight(selector, message, onTap)
	}

	private scheduleLaneIntroAdvance(): void {
		this.laneIntroTimer = setTimeout(() => {
			this.advanceLaneIntro()
		}, 2000)
	}

	public get laneIntroSelector(): string {
		switch (this.laneIntroPhase) {
			case 'home':
				return '[data-stage-home]'
			case 'near':
				return '[data-stage-near]'
			case 'away':
				return '[data-stage-away]'
			case 'card':
				return '[data-live-card]:first-child'
			default:
				return ''
		}
	}

	public get laneIntroMessage(): string {
		switch (this.laneIntroPhase) {
			case 'home':
				return this.i18n.tr('dashboard.laneIntro.home')
			case 'near':
				return this.i18n.tr('dashboard.laneIntro.near')
			case 'away':
				return this.i18n.tr('dashboard.laneIntro.away')
			case 'card':
				return this.i18n.tr('dashboard.coachMark.tapCard')
			default:
				return ''
		}
	}

	public get isLaneIntroActive(): boolean {
		return this.laneIntroPhase !== 'done'
	}

	public onTutorialCardTapped(): void {
		if (this.isTutorialStep3) {
			this.logger.info('Tutorial: concert card tapped, advancing to Step 4')
			this.onboarding.setStep(OnboardingStep.DETAIL)
			// Step 4: Spotlight slides to My Artists tab
			this.onboarding.activateSpotlight(
				'[data-nav-my-artists]',
				this.i18n.tr('dashboard.coachMark.viewArtists'),
				() => this.onTutorialMyArtistsTapped(),
			)
			// Re-insert coach mark above detail sheet in LIFO top-layer stack
			this.onboarding.bringSpotlightToFront()
		}
	}

	public async onTutorialMyArtistsTapped(): Promise<void> {
		if (this.isTutorialStep4) {
			this.logger.info('Tutorial: My Artists tab tapped, advancing to Step 5')
			this.onboarding.setStep(OnboardingStep.MY_ARTISTS)
			await this.router.load('my-artists')
		}
	}

	public onSignupRequested(): void {
		this.authService.signUp()
	}

	public detaching(): void {
		this.abortController?.abort()
		this.abortController = null
		if (this.laneIntroTimer) {
			clearTimeout(this.laneIntroTimer)
			this.laneIntroTimer = null
		}
	}
}
