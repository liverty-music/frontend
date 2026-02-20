import type { IRouteViewModel, NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from './services/auth-service'
import { IOnboardingService } from './services/onboarding-service'

export class WelcomePage implements IRouteViewModel {
	private readonly authService = resolve(IAuthService)
	private readonly onboardingService = resolve(IOnboardingService)
	private readonly logger = resolve(ILogger).scopeTo('WelcomePage')

	/**
	 * Router lifecycle hook - the canonical Aurelia 2 way to redirect.
	 * Returns a NavigationInstruction (string route path) to redirect authenticated users,
	 * or true to allow the welcome page to load for unauthenticated users.
	 *
	 * Note: router.load() must NOT be called from any lifecycle hook; the correct
	 * pattern is to return the target instruction from canLoad.
	 * Redirect targets must have @customElement to be resolvable by the router.
	 */
	async canLoad(): Promise<NavigationInstruction | boolean> {
		await this.authService.ready

		if (this.authService.isAuthenticated) {
			this.logger.info('User is authenticated, determining redirect target')
			return await this.onboardingService.getRedirectTarget()
		}

		return true
	}

	async handleSignUp(): Promise<void> {
		await this.authService.signUp()
	}

	async handleSignIn(): Promise<void> {
		await this.authService.signIn()
	}
}
