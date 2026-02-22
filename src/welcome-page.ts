import type { IRouteViewModel, NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { IOnboardingService } from './services/onboarding-service'

export class WelcomePage implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly onboardingService = resolve(IOnboardingService)
	private readonly logger = resolve(ILogger).scopeTo('WelcomePage')

	/**
	 * Router lifecycle hook - called before the component is loaded
	 * Prevents flash of unauthenticated content by checking auth status before rendering.
	 * Returns a redirect instruction instead of calling router.load() to avoid
	 * re-entrant navigation while the viewport is not yet registered (AUR3174).
	 */
	async canLoad(): Promise<NavigationInstruction | boolean> {
		this.logger.debug('Checking if landing page can load')

		// Wait for auth service to initialize
		await this.authService.ready

		// If user is authenticated, return a redirect instruction
		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, determining redirect target')
			try {
				return await this.onboardingService.getRedirectTarget()
			} catch (err) {
				this.logger.error('Failed to determine redirect target', { error: err })
				// Fall through to show landing page rather than crashing
				return true
			}
		}

		// User not authenticated, show landing page
		return true
	}

	async handleSignUp(): Promise<void> {
		await this.authService.signUp()
	}

	async handleSignIn(): Promise<void> {
		await this.authService.signIn()
	}
}
