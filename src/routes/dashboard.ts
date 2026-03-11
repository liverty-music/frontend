import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import type { DateGroup } from '../components/live-highway/live-event'
import { UserHomeSelector } from '../components/user-home-selector/user-home-selector'
import { IDashboardService } from '../services/dashboard-service'
import { ILocalArtistClient } from '../services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../services/onboarding-service'

export type LaneIntroPhase = 'home' | 'near' | 'away' | 'card' | 'done'

export class Dashboard {
	public dateGroups: DateGroup[] = []
	public needsRegion = false
	public loadError: unknown = null
	public isStale = false
	public showCelebration = false
	public laneIntroPhase: LaneIntroPhase = 'done'

	public homeSelector!: UserHomeSelector

	private readonly logger = resolve(ILogger).scopeTo('Dashboard')
	public readonly i18n = resolve(I18N)
	private readonly dashboardService = resolve(IDashboardService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly localClient = resolve(ILocalArtistClient)
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

	public async loading(): Promise<void> {
		this.needsRegion = !UserHomeSelector.getStoredHome()
		this.showCelebration =
			this.onboarding.currentStep === OnboardingStep.DASHBOARD
		this.loadData()
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
		if (this.isOnboarding) {
			this.localClient.setHome(code)
			this.startLaneIntro()
		}
	}

	public onLaneIntroTap(): void {
		this.advanceLaneIntro()
	}

	private startLaneIntro(): void {
		if (!this.isTutorialStep3) return
		this.laneIntroPhase = 'home'
		this.logger.info('Lane intro started')
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

		this.laneIntroPhase = phases[currentIdx + 1]
		this.logger.info('Lane intro advanced', { phase: this.laneIntroPhase })

		if (this.laneIntroPhase !== 'done' && this.laneIntroPhase !== 'card') {
			this.scheduleLaneIntroAdvance()
		}
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
		}
	}

	public async onTutorialMyArtistsTapped(): Promise<void> {
		if (this.isTutorialStep4) {
			this.logger.info('Tutorial: My Artists tab tapped, advancing to Step 5')
			this.onboarding.setStep(OnboardingStep.MY_ARTISTS)
			await this.router.load('my-artists')
		}
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
