import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { IOnboardingService } from '../services/onboarding-service'

export class AuthCallback {
	public message = 'Verifying authentication...'
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly onboardingService = resolve(IOnboardingService)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallback')

	constructor() {
		this.logger.info('Constructor called')
	}

	// biome-ignore lint/suspicious/noExplicitAny: Params are dynamic
	public async loading(params: any): Promise<void> {
		this.logger.info('Starting loading hook...', params)
		try {
			this.logger.info('Calling handleCallback...')
			await this.authService.handleCallback()
			this.logger.info('handleCallback success!')
			await this.onboardingService.redirectBasedOnStatus()
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			// If we are already authenticated (e.g. valid session exists), ignore the error and redirect
			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				await this.onboardingService.redirectBasedOnStatus()
				return
			}

			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			this.message = ''
		}
	}
}
