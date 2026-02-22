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
		this.logger.info('Checking onboarding status via ListFollowed RPC')
		const response = await this.artistServiceClient
			.getClient()
			.listFollowed({ limit: 1 }) // Only need to check if at least 1 exists

		return response.artists.length >= 1
	}

	/**
	 * Determine the appropriate redirect target based on onboarding status.
	 * Returns a route path string suitable for use as a canLoad return value.
	 * - Completed onboarding → 'dashboard'
	 * - Not completed → 'onboarding/discover'
	 */
	public async getRedirectTarget(): Promise<string> {
		const hasCompleted = await this.hasCompletedOnboarding()
		if (hasCompleted) {
			this.logger.info(
				'User has completed onboarding, redirecting to dashboard',
			)
			return 'dashboard'
		}
		this.logger.info(
			'User has not completed onboarding, redirecting to discovery',
		)
		return 'onboarding/discover'
	}

	/**
	 * Redirect user to the appropriate page based on onboarding status.
	 * Safe to call from loading hooks or user-initiated actions (not from canLoad).
	 * - Completed onboarding → dashboard
	 * - Not completed → artist discovery
	 */
	public async redirectBasedOnStatus(): Promise<void> {
		await this.authService.ready

		if (!this.authService.isAuthenticated) {
			this.logger.debug('User not authenticated, no redirect needed')
			return
		}

		const target = await this.getRedirectTarget()
		await this.router.load(target)
	}
}
