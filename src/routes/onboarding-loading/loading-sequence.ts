import { IRouter } from '@aurelia/router'
import { ILogger, resolve, shadowCSS, useShadowDOM } from 'aurelia'
import { IArtistDiscoveryService } from '../../services/artist-discovery-service'
import { IAuthService } from '../../services/auth-service'
import { ILoadingSequenceService } from '../../services/loading-sequence-service'

@useShadowDOM()
export class LoadingSequence {
	static dependencies = [
		shadowCSS(`
			.container {
				position: fixed;
				top: 0;
				left: 0;
				width: 100%;
				height: 100vh;
				display: flex;
				align-items: center;
				justify-content: center;
				background: linear-gradient(to bottom, rgb(3, 7, 18), rgb(49, 46, 129), rgb(3, 7, 18));
			}

			.message-container {
				text-align: center;
				padding: 2rem;
			}

			.loading-message {
				font-size: 1.5rem;
				font-weight: 600;
				color: white;
				margin: 0;
				opacity: 0;
				transition: opacity 0.8s ease-in-out;
			}

			.loading-message.phase-visible {
				opacity: 1;
			}

			@media (max-width: 640px) {
				.loading-message {
					font-size: 1.25rem;
					padding: 0 1rem;
				}
			}
		`),
	]

	private readonly router = resolve(IRouter)
	private readonly logger = resolve(ILogger).scopeTo('LoadingSequence')
	private readonly loadingService = resolve(ILoadingSequenceService)
	private readonly authService = resolve(IAuthService)
	private readonly artistDiscoveryService = resolve(IArtistDiscoveryService)

	public currentPhase = 1
	public currentPhaseMessage = ''
	public isPhaseVisible = true

	private phaseTimer: number | null = null
	private readonly FADE_DURATION_MS = 800

	private readonly phases = [
		{ duration: 2000, message: 'あなたのMusic DNAを構築中...' },
		{ duration: 3000, message: '全国のライブスケジュールと照合中...' },
		{ duration: Infinity, message: 'AIが最新のツアー情報を検索中... 🤖' },
	]

	public async canLoad(): Promise<boolean> {
		// Navigation guard: prevent direct access based on auth/onboarding state
		this.logger.info('Checking navigation guard', {
			isAuthenticated: this.authService.isAuthenticated,
		})

		// Redirect unauthenticated users to landing page
		if (!this.authService.isAuthenticated) {
			this.logger.info('Unauthenticated, redirecting to landing page')
			await this.router.load('/')
			return false
		}

		// Check if user has already completed onboarding by fetching followed artists from backend
		try {
			const backendFollowedArtists =
				await this.artistDiscoveryService.listFollowedFromBackend()

			if (backendFollowedArtists.length > 0) {
				// User has already completed onboarding, redirect to dashboard
				this.logger.info(
					'User has followed artists in backend, redirecting to dashboard',
					{ count: backendFollowedArtists.length },
				)
				await this.router.load('/dashboard')
				return false
			}

			// Check local state for followed artists
			const localFollowedCount =
				this.artistDiscoveryService.followedArtists.length

			if (localFollowedCount === 0) {
				// User has no followed artists, redirect to discovery
				this.logger.info(
					'User has no followed artists, redirecting to discovery',
				)
				await this.router.load('/onboarding/discover')
				return false
			}

			// User has followed artists locally but not in backend yet
			// Allow access to run aggregation
			this.logger.info('Allowing access to loading sequence', {
				localFollowedCount,
			})
			return true
		} catch (err) {
			// If backend call fails, check local state only
			this.logger.warn('Failed to fetch backend followed artists, using local state', err)

			const localFollowedCount =
				this.artistDiscoveryService.followedArtists.length

			if (localFollowedCount === 0) {
				this.logger.info(
					'No local followed artists, redirecting to discovery',
				)
				await this.router.load('/onboarding/discover')
				return false
			}

			// Allow access if we have local followed artists
			return true
		}
	}

	public loading(): void {
		this.logger.info('Loading sequence started')
		this.currentPhase = 1
		this.currentPhaseMessage = this.phases[0].message
	}

	public async attached(): Promise<void> {
		this.startPhaseAnimation()

		// Start data aggregation after component is rendered
		try {
			await this.loadingService.aggregateData()
			this.logger.info('Data aggregation completed, navigating to dashboard')
			await this.router.load('/dashboard')
		} catch (err) {
			this.logger.error('Data aggregation failed, navigating to dashboard anyway', err)
			await this.router.load('/dashboard')
		}
	}

	public unbinding(): void {
		if (this.phaseTimer !== null) {
			clearTimeout(this.phaseTimer)
			this.phaseTimer = null
		}
	}

	private startPhaseAnimation(): void {
		// Start with phase 1
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
			// Fade out current message
			this.isPhaseVisible = false

			// Wait for fade-out animation, then update message and fade in
			this.phaseTimer = window.setTimeout(() => {
				this.currentPhase++
				if (this.currentPhase <= this.phases.length) {
					this.currentPhaseMessage = this.phases[this.currentPhase - 1].message
					// Trigger fade-in
					this.phaseTimer = window.setTimeout(() => {
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
}
