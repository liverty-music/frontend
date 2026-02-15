import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { UserEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb'
import { IAuthService } from '../services/auth-service'
import { IUserService } from '../services/user-service'
import { IOnboardingService } from '../services/onboarding-service'

/**
 * OIDC state object structure for tracking registration flow
 */
interface AuthState {
	isRegistration?: boolean
}

export class AuthCallback {
	public message = 'Verifying authentication...'
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
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
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			// Check if this was a registration flow
			const state = user.state as AuthState | undefined
			if (state?.isRegistration) {
				this.logger.info('Registration detected, provisioning user in backend')
				await this.provisionUser(user.profile.email)
			}

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

	// Call Create RPC with error handling
	private async provisionUser(email: string | undefined): Promise<void> {
		if (!email) {
			this.logger.error('User email is missing, cannot provision user')
			return
		}

		try {
			await this.userService.client.create({
				email: new UserEmail({ value: email }),
			})
			this.logger.info('User provisioned successfully', { email })
		} catch (err) {
			// Handle ALREADY_EXISTS gracefully (treat as success)
			if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
				this.logger.info('User already exists in backend, continuing...', {
					email,
				})
				return
			}

			// Handle other failures gracefully — log error but complete auth flow
			this.logger.error(
				'Failed to provision user in backend, continuing auth flow anyway',
				{ email, error: err },
			)
			// Do not throw - allow authentication to succeed even if provisioning fails
		}
	}
}
