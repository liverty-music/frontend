import { I18N } from '@aurelia/i18n'
import { IRouter, type NavigationInstruction } from '@aurelia/router'
import { IEventAggregator, ILogger, INode, resolve } from 'aurelia'
import { Toast } from '../../components/toast-notification/toast'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { IFollowServiceClient } from '../../services/follow-service-client'
import { ILoadingSequenceService } from '../../services/loading-sequence-service'
import { ILocalArtistClient } from '../../services/local-artist-client'
import { IOnboardingService } from '../../services/onboarding-service'
export class LoadingSequence {
	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LoadingSequence')
	private readonly loadingService = resolve(ILoadingSequenceService)
	private readonly followClient = resolve(IFollowServiceClient)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly ea = resolve(IEventAggregator)
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly i18n = resolve(I18N)
	private readonly host = resolve(INode) as HTMLElement

	public currentPhase = 1
	public currentPhaseMessage = ''
	public isPhaseVisible = true

	private nextRoute: string | null = null
	private phaseTimer: number | null = null

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
		// Onboarding users no longer use this route — redirect to dashboard
		if (this.onboarding.isOnboarding) {
			this.logger.info(
				'Onboarding user reached loading-sequence, redirecting to dashboard',
			)
			return 'dashboard'
		}

		// Authenticated mode: check backend
		try {
			const abortController = new AbortController()
			const backendFollowedArtists =
				await this.followClient.listFollowedAsBubbles(abortController.signal)

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
				this.ea.publish(
					new Toast(
						this.i18n.tr('loading.partialFailure', {
							failed: result.failedCount,
							total: result.totalCount,
						}),
						'warning',
					),
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

			// Use transitionend instead of setTimeout for fade duration
			const messageEl = this.getMessageElement()
			if (messageEl && !this.prefersReducedMotion()) {
				messageEl.addEventListener(
					'transitionend',
					() => {
						this.advancePhase()
					},
					{ once: true },
				)
			} else {
				// Reduced motion or no element: advance immediately
				this.advancePhase()
			}
		}, currentPhaseConfig.duration)
	}

	private advancePhase(): void {
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
	}

	private getMessageElement(): HTMLElement | null {
		return this.host.querySelector('.loading-message')
	}

	private prefersReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches
	}

	public getStepState(index: number): 'complete' | 'active' | '' {
		const phase1Based = index + 1
		if (phase1Based < this.currentPhase) return 'complete'
		if (phase1Based === this.currentPhase) return 'active'
		return ''
	}
}
