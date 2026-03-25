import { I18N } from '@aurelia/i18n'
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
	/** Beam indices keyed by event ID, for laser beam tracking. */
	public beamIndexMap = new Map<string, number>()
	public needsRegion = false
	public loadError: unknown = null
	public showCelebration = false
	public laneIntroPhase: LaneIntroPhase = 'done'
	public showSignupBanner = false
	public showPostSignupDialog = false
	/** Prefecture name resolved after Home Selector selection, used for dynamic coach mark text. */
	public selectedPrefectureName = ''

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
	private abortController: AbortController | null = null
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

		// Show signup banner for unauthenticated users who completed onboarding
		if (!this.authService.isAuthenticated && this.onboarding.isCompleted) {
			this.showSignupBanner = true
		}

		// PostSignupDialog: show once after first-time signup
		if (localStorage.getItem('liverty:postSignup:shown') === 'pending') {
			localStorage.removeItem('liverty:postSignup:shown')
			this.showPostSignupDialog = true
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
				`userHome.prefectures.${code.toLowerCase().replace('jp-', '')}`,
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
		if (this.dataPromise) {
			try {
				await this.dataPromise
			} catch {
				// Data load failed — proceed with whatever we have
			}
		}

		// When no concert data is available, skip lane intro and show celebration
		if (this.dateGroups.length === 0) {
			this.logger.warn('No concert data available, skipping lane intro')
			this.laneIntroPhase = 'done'
			this.showCelebration = true
			return
		}

		this.setNavTabsDimmed(true)

		// HOME phase: open Home Selector inline if region not yet set
		if (this.needsRegion) {
			this.laneIntroPhase = 'waiting-for-home'
			this.homeSelector.open()
			// Spotlight the HOME stage while waiting for selection
			this.onboarding.activateSpotlight(
				'[data-stage="home"]',
				this.i18n.tr('dashboard.laneIntro.homePrompt'),
				undefined,
			)
		} else {
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
		this.logger.info('Lane intro completed, showing celebration')
		this.showCelebration = true
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
					? this.i18n.tr('dashboard.laneIntro.homeSelected', {
							prefecture: this.selectedPrefectureName,
						})
					: this.i18n.tr('dashboard.laneIntro.home')
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
