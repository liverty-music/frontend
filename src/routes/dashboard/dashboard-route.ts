import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { ILogger, INode, resolve } from 'aurelia'
import { artistHue } from '../../adapter/view/artist-color'
import type { EventDetailSheet } from '../../components/live-highway/event-detail-sheet'
import type {
	DateGroup,
	LiveEvent,
} from '../../components/live-highway/live-event'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { StorageKeys } from '../../constants/storage-keys'
import { IAuthService } from '../../services/auth-service'
import { IDashboardService } from '../../services/dashboard-service'
import { IGuestService } from '../../services/guest-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import { IUserService } from '../../services/user-service'

export type LaneIntroPhase = 'home' | 'near' | 'away' | 'card' | 'done'

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
	/** Beam indices keyed by event ID, for laser beam tracking. */
	public beamIndexMap = new Map<string, number>()
	public needsRegion = false
	public loadError: unknown = null
	public showCelebration = false
	public laneIntroPhase: LaneIntroPhase = 'done'
	public showSignupBanner = false

	public homeSelector!: UserHomeSelector
	public detailSheet!: EventDetailSheet

	private readonly element = resolve(INode) as HTMLElement
	private readonly logger = resolve(ILogger).scopeTo('DashboardRoute')
	public readonly i18n = resolve(I18N)
	private readonly authService = resolve(IAuthService)
	private readonly dashboardService = resolve(IDashboardService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly guest = resolve(IGuestService)
	private readonly userService = resolve(IUserService)
	private readonly router = resolve(IRouter)
	private abortController: AbortController | null = null
	private laneIntroTimer: ReturnType<typeof setTimeout> | null = null
	private beamRafId = 0
	private readonly onScroll = (): void => this.scheduleBeamUpdate()

	public dataPromise: Promise<DateGroup[]> | null = null

	/** Triangular laser beams — one per matched card. */
	public laserBeams: {
		anchorIndex: number
		hue: number
		left: string
		right: string
	}[] = []

	/** Assign sequential beam indices to matched events across all groups. */
	private buildBeamIndexMap(): void {
		const map = new Map<string, number>()
		const beams: typeof this.laserBeams = []
		let idx = 0

		// Lane boundaries as viewport percentages (3-column 1fr grid)
		const LANE_PCT = [
			{ left: 1, right: 32 },
			{ left: 34.5, right: 65.5 },
			{ left: 68, right: 99 },
		]

		for (const group of this.dateGroups) {
			const lanes = [group.home, group.nearby, group.away]
			for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
				for (const ev of lanes[laneIdx]) {
					if (ev.matched) {
						map.set(ev.id, idx)
						const { left, right } = LANE_PCT[laneIdx]
						beams.push({
							anchorIndex: idx,
							hue: artistHue(ev.artistName),
							left: `${left}%`,
							right: `${right}%`,
						})
						idx++
					}
				}
			}
		}

		this.beamIndexMap = map
		this.laserBeams = beams
		// Schedule initial position update after Aurelia renders the beam elements
		requestAnimationFrame(() => this.updateBeamPositions())
	}

	public getBeamIndex(eventId: string): number | null {
		return this.beamIndexMap.get(eventId) ?? null
	}

	public get isOnboardingStepDashboard(): boolean {
		return this.onboarding.currentStep === OnboardingStep.DASHBOARD
	}

	public get isOnboardingStepDetail(): boolean {
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
			this.needsRegion = !this.userService.current?.home
		} else {
			this.needsRegion = !UserHomeSelector.getStoredHome()
		}
		this.showCelebration =
			this.onboarding.currentStep === OnboardingStep.DASHBOARD &&
			!DashboardRoute.celebrationShown
		if (this.showCelebration) {
			DashboardRoute.celebrationShown = true
		}
		this.loadData()

		// When returning to step 3 with celebration and region already resolved,
		// resume the lane intro (e.g. page reload during onboarding)
		if (
			this.isOnboardingStepDashboard &&
			!this.showCelebration &&
			!this.needsRegion
		) {
			this.startLaneIntro()
		}

		// Show signup banner for unauthenticated users who completed onboarding
		if (!this.authService.isAuthenticated && this.onboarding.isCompleted) {
			this.showSignupBanner = true
		}

		// Resume step 4 spotlight after reload: re-activate My Artists tab spotlight
		// so the user can proceed. bringSpotlightToFront ensures the coach mark
		// renders above the detail sheet in the top-layer LIFO stack.
		if (this.isOnboardingStepDetail) {
			this.onboarding.activateSpotlight(
				'[data-nav="my-artists"]',
				this.i18n.tr('dashboard.coachMark.viewArtists'),
				() => this.onOnboardingMyArtistsTapped(),
			)
			this.onboarding.bringSpotlightToFront()
		}
	}

	public loadData(): void {
		this.abortController?.abort()
		this.abortController = new AbortController()
		this.loadError = null

		this.dataPromise = this.dashboardService
			.loadDashboardEvents(this.abortController.signal)
			.then((groups) => {
				this.dateGroups = groups
				this.buildBeamIndexMap()
				this.loadError = null
				this.logger.info('Dashboard loaded', { groups: groups.length })
				return groups
			})
			.catch((err) => {
				if ((err as Error).name === 'AbortError') {
					throw err
				}
				this.logger.error('Failed to load dashboard', { error: err })
				// If we have previous data, silently keep showing it
				if (this.dateGroups.length > 0) {
					return this.dateGroups
				}
				this.loadError = err
				throw err
			})
	}

	public attached(): void {
		if (this.needsRegion && !this.showCelebration) {
			this.homeSelector.open()
		}
		this.setupBeamTracking()
	}

	/** Wire scroll listener for JS-based beam height tracking. */
	private setupBeamTracking(): void {
		const scroll = this.element.querySelector('.concert-scroll')
		if (scroll) {
			scroll.addEventListener('scroll', this.onScroll, { passive: true })
			this.scheduleBeamUpdate()
		}
	}

	private scheduleBeamUpdate(): void {
		if (this.beamRafId) return
		this.beamRafId = requestAnimationFrame(() => {
			this.beamRafId = 0
			this.updateBeamPositions()
		})
	}

	/** Set beam dimensions so triangle wraps card diagonally (bottom-left to top-right). */
	private updateBeamPositions(): void {
		const beamEls = this.element.querySelectorAll<HTMLElement>('.laser-beam')
		const vh = window.innerHeight
		for (const beamEl of beamEls) {
			const idx = beamEl.dataset.beamAnchor
			if (idx == null) continue
			const card = this.element.querySelector<HTMLElement>(
				`[data-beam-index="${idx}"]`,
			)
			if (!card) continue
			const rect = card.getBoundingClientRect()
			// Only illuminate cards visible in the viewport
			const visible = rect.bottom > 0 && rect.top < vh
			if (visible) {
				const bottom = Math.max(0, rect.bottom)
				const topPct =
					bottom > 0 ? `${(Math.max(0, rect.top) / bottom) * 100}%` : '80%'
				beamEl.style.setProperty('--beam-h', `${bottom}px`)
				beamEl.style.setProperty('--beam-top-pct', topPct)
			} else {
				beamEl.style.setProperty('--beam-h', '0')
			}
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
		if (!this.authService.isAuthenticated) {
			this.guest.setHome(code)
		}
		this.loadData()
		if (this.isOnboarding) {
			this.startLaneIntro()
		}
	}

	public onLaneIntroTap(): void {
		this.advanceLaneIntro()
	}

	private async startLaneIntro(): Promise<void> {
		if (!this.isOnboardingStepDashboard) return

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
			'[data-nav="my-artists"]',
			this.i18n.tr('dashboard.coachMark.viewArtists'),
			() => this.onOnboardingMyArtistsTapped(),
		)
	}

	private updateSpotlightForPhase(): void {
		const selector = this.laneIntroSelector
		const message = this.laneIntroMessage
		if (!selector) return

		const onTap =
			this.laneIntroPhase === 'card'
				? () => this.onOnboardingCardTapped()
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
				return '[data-stage="home"]'
			case 'near':
				return '[data-stage="near"]'
			case 'away':
				return '[data-stage="away"]'
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

	public onOnboardingCardTapped(): void {
		if (this.isOnboardingStepDashboard) {
			this.logger.info('Onboarding: concert card tapped, advancing to detail')
			this.onboarding.setStep(OnboardingStep.DETAIL)
			// Step 4: Spotlight slides to My Artists tab
			this.onboarding.activateSpotlight(
				'[data-nav="my-artists"]',
				this.i18n.tr('dashboard.coachMark.viewArtists'),
				() => this.onOnboardingMyArtistsTapped(),
			)
			// Re-insert coach mark above detail sheet in LIFO top-layer stack
			this.onboarding.bringSpotlightToFront()
		}
	}

	public async onOnboardingMyArtistsTapped(): Promise<void> {
		if (this.isOnboardingStepDetail) {
			this.logger.info(
				'Onboarding: My Artists tab tapped, advancing to my-artists',
			)
			this.onboarding.setStep(OnboardingStep.MY_ARTISTS)
			await this.router.load('my-artists')
		}
	}

	public onEventSelected(event: CustomEvent<{ event: LiveEvent }>): void {
		this.detailSheet.open(event.detail.event)
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
		if (this.laneIntroTimer) {
			clearTimeout(this.laneIntroTimer)
			this.laneIntroTimer = null
		}
		const scroll = this.element.querySelector('.concert-scroll')
		if (scroll) {
			scroll.removeEventListener('scroll', this.onScroll)
		}
		if (this.beamRafId) {
			cancelAnimationFrame(this.beamRafId)
			this.beamRafId = 0
		}
	}
}
