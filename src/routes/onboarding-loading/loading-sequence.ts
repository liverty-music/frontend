import { IRouter } from '@aurelia/router'
import { ILogger, resolve, shadowCSS, useShadowDOM } from 'aurelia'
import { IToastService } from '../../components/toast-notification/toast-notification'
import { IArtistDiscoveryService } from '../../services/artist-discovery-service'
import { IErrorBoundaryService } from '../../services/error-boundary-service'
import { ILoadingSequenceService } from '../../services/loading-sequence-service'
import css from './loading-sequence.css?raw'

@useShadowDOM()
export class LoadingSequence {
	static dependencies = [shadowCSS(css)]

	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LoadingSequence')
	private readonly loadingService = resolve(ILoadingSequenceService)
	private readonly artistDiscoveryService = resolve(IArtistDiscoveryService)
	private readonly toastService = resolve(IToastService)
	private readonly errorBoundary = resolve(IErrorBoundaryService)

	public currentPhase = 1
	public currentPhaseMessage = ''
	public isPhaseVisible = true

	private phaseTimer: number | null = null
	private readonly FADE_DURATION_MS = 600

	private readonly phases = [
		{ duration: 2000, message: 'あなたのMusic DNAを構築中...' },
		{ duration: 3000, message: '全国のライブスケジュールと照合中...' },
		{ duration: Infinity, message: 'AIが最新のツアー情報を検索中... 🤖' },
	]

	public get totalPhases(): number {
		return this.phases.length
	}

	public async canLoad(): Promise<boolean> {
		// Onboarding state guard (authentication is enforced by the global AuthHook)

		try {
			const abortController = new AbortController()
			const backendFollowedArtists =
				await this.artistDiscoveryService.listFollowedFromBackend(
					abortController.signal,
				)

			if (backendFollowedArtists.length > 0) {
				this.logger.info(
					'User has followed artists in backend, redirecting to dashboard',
					{ count: backendFollowedArtists.length },
				)
				await this.router.load('/dashboard')
				return false
			}

			const localFollowedCount =
				this.artistDiscoveryService.followedArtists.length

			if (localFollowedCount === 0) {
				this.logger.info(
					'User has no followed artists, redirecting to discovery',
				)
				await this.router.load('/onboarding/discover')
				return false
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

			const localFollowedCount =
				this.artistDiscoveryService.followedArtists.length

			if (localFollowedCount === 0) {
				this.logger.info('No local followed artists, redirecting to discovery')
				await this.router.load('/onboarding/discover')
				return false
			}

			return true
		}
	}

	public binding(): void {
		this.logger.info('Loading sequence started')
		this.currentPhase = 1
		this.currentPhaseMessage = this.phases[0].message
	}

	public async attached(): Promise<void> {
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
				this.toastService.show(
					`Some artist schedules couldn't be loaded (${result.failedCount}/${result.totalCount})`,
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

		await this.router.load('/dashboard')
	}

	public unbinding(): void {
		if (this.phaseTimer !== null) {
			clearTimeout(this.phaseTimer)
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
