import { IRouter } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'

export class AuthCallback {
	public message = 'Verifying authentication...'
	public error = ''

	private authService = resolve(IAuthService)
	private router = resolve(IRouter)
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
			await this.router.load('/')
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			// If we are already authenticated (e.g. valid session exists), ignore the error and redirect
			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				await this.router.load('/')
				return
			}

			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			this.message = ''
		}
	}
}
