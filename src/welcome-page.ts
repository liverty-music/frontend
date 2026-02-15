import type { IRouteViewModel } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { IOnboardingService } from './services/onboarding-service'

export class WelcomePage implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly onboardingService = resolve(IOnboardingService)
	private readonly logger = resolve(ILogger).scopeTo('WelcomePage')

	/**
	 * Router lifecycle hook - called before the component is loaded
	 * Prevents flash of unauthenticated content by checking auth status before rendering
	 */
	async canLoad(): Promise<boolean> {
		this.logger.debug('Checking if landing page can load')

		// Wait for auth service to initialize
		await this.authService.ready

		// If user is authenticated, redirect and prevent landing page from loading
		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, redirecting based on onboarding status')
			await this.onboardingService.redirectBasedOnStatus()
			return false // Prevent landing page from loading
		}

		// User not authenticated, show landing page
		return true
	}

	async handleSignUp(): Promise<void> {
		await this.authService.register()
	}

	async handleSignIn(): Promise<void> {
		await this.authService.signIn()
	}
}
