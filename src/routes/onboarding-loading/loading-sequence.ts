import { I18N } from '@aurelia/i18n'
import { IRouter, type NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve, shadowCSS, useShadowDOM } from 'aurelia'
import { IToastService } from '../../components/toast-notification/toast-notification'
import { IArtistServiceClient } from '../../services/artist-service-client'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { ILoadingSequenceService } from '../../services/loading-sequence-service'
import { ILocalArtistClient } from '../../services/local-artist-client'
import {
	IOnboardingService,
	OnboardingStep,
} from '../../services/onboarding-service'
import css from './loading-sequence.css?raw'

@useShadowDOM()
export class LoadingSequence {
	static dependencies = [shadowCSS(css)]

	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LoadingSequence')
	private readonly loadingService = resolve(ILoadingSequenceService)
	private readonly artistClient = resolve(IArtistServiceClient)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly toastService = resolve(IToastService)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly i18n = resolve(I18N)

	public currentPhase = 1
	public currentPhaseMessage = ''
	public isPhaseVisible = true

	private nextRoute: string | null = null
	private isOnboardingFlow = false
	private phaseTimer: number | null = null
	private displayTimer: number | null = null
	private readonly FADE_DURATION_MS = 600
	private readonly ONBOARDING_DISPLAY_MS = 3000

	private get phases() {
		return [
			{ duration: 2000, message: this.i18n.tr('loading.phase1') },
			{ duration: 3000, message: this.i18n.tr('loading.phase2') },
			{ duration: Infinity, message: this.i18n.tr('loading.phase3') },
		]
	}

	public get totalPhases(): number {
		return this.phases.length
	}

	public get searchCompletedCount(): number {
		return this.loadingService.completedCount
	}

	public get searchTotalCount(): number {
		return this.loadingService.totalCount
	}

	public async canLoad(): Promise<NavigationInstruction | boolean> {
		// Tutorial mode: check guest data instead of backend
		if (this.onboarding.isOnboarding) {
			const guestCount = this.localClient.followedCount
			if (guestCount === 0) {
				this.logger.info(
					'Tutorial: no guest followed artists, redirecting to discovery',
				)
				return 'discover'
			}
			this.logger.info('Tutorial: allowing loading sequence', { guestCount })
			return true
		}

		// Authenticated mode: check backend
		try {
			const abortController = new AbortController()
			const backendFollowedArtists =
				await this.artistClient.listFollowedAsBubbles(abortController.signal)

			if (backendFollowedArtists.length > 0) {
				this.logger.info(
					'User has followed artists in backend, redirecting to dashboard',
					{ count: backendFollowedArtists.length },
				)
				return 'dashboard'
			}

			const localFollowedCount = this.localClient.followedCount

			if (localFollowedCount === 0) {
				this.logger.info(
					'User has no followed artists, redirecting to discovery',
				)
				return 'discover'
			}

			this.logger.info('Allowing access to loading sequence', {
				localFollowedCount,
			})
			return true
		} catch (err) {
			this.logger.warn(
				'Failed to fetch backend followed artists, using local state',
				err,
			)

			const localFollowedCount = this.localClient.followedCount

			if (localFollowedCount === 0) {
				this.logger.info('No local followed artists, redirecting to discovery')
				return 'discover'
			}

			return true
		}
	}

	public binding(): void {
		this.logger.info('Loading sequence started')
		this.currentPhase = 1
		this.currentPhaseMessage = this.phases[0].message
	}

	/**
	 * loading() is awaited by the router's transition pipeline, so we perform
	 * all async work (animation delay, data aggregation) here and store the
	 * navigation target for attached() to pick up.
	 */
	public async loading(): Promise<void> {
		this.startPhaseAnimation()

		if (this.onboarding.isOnboarding) {
			// Return immediately so the router swaps in the loading screen.
			// The display timer in attached() handles the 3s wait + navigation.
			this.isOnboardingFlow = true
			return
		}

		const result = await this.loadingService.aggregateData()

		switch (result.status) {
			case 'success':
				this.logger.info('Data aggregation completed, navigating to dashboard')
				break
			case 'partial':
				this.logger.warn('Partial data aggregation failure', {
					failedCount: result.failedCount,
					totalCount: result.totalCount,
				})
				this.toastService.show(
					this.i18n.tr('loading.partialFailure', {
						failed: result.failedCount,
						total: result.totalCount,
					}),
					'warning',
				)
				break
			case 'failed':
				this.logger.error('Complete data aggregation failure', {
					error: result.error,
				})
				this.errorBoundary.captureError(
					result.error,
					'LoadingSequence:aggregateData',
				)
				break
		}

		this.nextRoute = '/dashboard'
	}

	/**
	 * attached() is NOT awaited by the router's batch chain (_swap).
	 * Calling router.load() synchronously here would enqueue a transition that
	 * may be orphaned because _runNextTransition() has already completed.
	 * Deferring to a macrotask (setTimeout) ensures the current transition
	 * pipeline finishes before the new navigation starts.
	 */
	public attached(): void {
		if (this.isOnboardingFlow) {
			this.displayTimer = window.setTimeout(() => {
				this.onboarding.setStep(OnboardingStep.DASHBOARD)
				this.router.load('/dashboard')
			}, this.ONBOARDING_DISPLAY_MS)
			return
		}

		if (this.nextRoute) {
			const route = this.nextRoute
			this.nextRoute = null
			setTimeout(() => {
				this.router.load(route)
			}, 0)
		}
	}

	public unbinding(): void {
		if (this.phaseTimer !== null) {
			window.clearTimeout(this.phaseTimer)
			this.phaseTimer = null
		}
		if (this.displayTimer !== null) {
			window.clearTimeout(this.displayTimer)
			this.displayTimer = null
		}
	}

	private startPhaseAnimation(): void {
		this.scheduleNextPhase()
	}

	private scheduleNextPhase(): void {
		if (this.currentPhase >= this.phases.length) {
			return
		}

		const currentPhaseConfig = this.phases[this.currentPhase - 1]
		if (currentPhaseConfig.duration === Infinity) {
			return
		}

		this.phaseTimer = window.setTimeout(() => {
			if (this.phaseTimer === null) return
			this.isPhaseVisible = false

			this.phaseTimer = window.setTimeout(() => {
				if (this.phaseTimer === null) return
				this.currentPhase++
				if (this.currentPhase <= this.phases.length) {
					this.currentPhaseMessage = this.phases[this.currentPhase - 1].message
					this.phaseTimer = window.setTimeout(() => {
						if (this.phaseTimer === null) return
						this.isPhaseVisible = true
						this.scheduleNextPhase()
					}, 50)
				}
			}, this.FADE_DURATION_MS)
		}, currentPhaseConfig.duration)
	}

	public getPhaseClass(): string {
		return this.isPhaseVisible ? 'phase-visible' : ''
	}

	public getStepDotClass(index: number): string {
		const phase1Based = index + 1
		if (phase1Based < this.currentPhase) {
			return 'completed'
		}
		if (phase1Based === this.currentPhase) {
			return 'active'
		}
		return ''
	}
}
