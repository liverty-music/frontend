import { IRouter } from '@aurelia/router'
import { UserEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { IUserService } from '../services/user-service'

/**
 * OIDC state object structure for tracking sign-up flow
 */
interface AuthState {
	isSignUp?: boolean
}

export class AuthCallback {
	public message = 'Verifying authentication...'
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly router = resolve(IRouter)
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

			// Check if this was a sign-up flow
			const state = user.state as AuthState | undefined
			if (state?.isSignUp) {
				this.logger.info('Sign-up detected, provisioning user in backend')
				await this.provisionUser(user.profile.email)
				await this.router.load('/onboarding/discover')
			} else {
				await this.router.load('/dashboard')
			}
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			// If we are already authenticated (e.g. valid session exists), ignore the error and redirect
			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				try {
					await this.router.load('/dashboard')
				} catch (redirectErr) {
					this.logger.error(
						'Post-auth redirect also failed, falling back to dashboard',
						{ error: redirectErr },
					)
					this.error =
						'Authentication succeeded but navigation failed. Please go to the dashboard manually.'
					this.message = ''
				}
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
