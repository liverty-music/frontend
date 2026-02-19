import { IRouter } from '@aurelia/router'
import { DI, ILogger, resolve } from 'aurelia'
import { IArtistServiceClient } from './artist-service-client'
import { IAuthService } from './auth-service'

export const IOnboardingService = DI.createInterface<IOnboardingService>(
	'IOnboardingService',
	(x) => x.singleton(OnboardingService),
)

export interface IOnboardingService extends OnboardingService {}

export class OnboardingService {
	private readonly logger = resolve(ILogger).scopeTo('OnboardingService')
	private readonly authService = resolve(IAuthService)
	private readonly artistServiceClient = resolve(IArtistServiceClient)
	private readonly router = resolve(IRouter)

	/**
	 * Check if the user has completed onboarding by verifying they follow at least one artist
	 */
	public async hasCompletedOnboarding(): Promise<boolean> {
		try {
			this.logger.info('Checking onboarding status via ListFollowed RPC')
			const response = await this.artistServiceClient
				.getClient()
				.listFollowed({ limit: 1 }) // Only need to check if at least 1 exists

			return response.artists.length >= 1
		} catch (err) {
			this.logger.error('Failed to check onboarding status', err)
			// On error, assume not completed (safer default)
			return false
		}
	}

	/**
	 * Redirect user to the appropriate page based on onboarding status
	 * - Completed onboarding → dashboard
	 * - Not completed → artist discovery
	 */
	public async redirectBasedOnStatus(): Promise<void> {
		// Wait for auth service to be ready
		await this.authService.ready

		// Only redirect if user is authenticated
		if (!this.authService.isAuthenticated) {
			this.logger.debug('User not authenticated, no redirect needed')
			return
		}

		const hasCompleted = await this.hasCompletedOnboarding()

		if (hasCompleted) {
			this.logger.info(
				'User has completed onboarding, redirecting to dashboard',
			)
			await this.router.load('dashboard')
		} else {
			this.logger.info(
				'User has not completed onboarding, redirecting to discovery',
			)
			await this.router.load('onboarding/discover')
		}
	}
}
