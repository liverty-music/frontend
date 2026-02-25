import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
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

/**
 * OIDC callback handler that processes the authorization code exchange
 * and redirects to the appropriate destination.
 *
 * Uses canLoad() to return a NavigationInstruction, which the Aurelia Router
 * handles internally within the transition pipeline. This avoids calling
 * router.load() from attached(), which can hang because attached() fires
 * during the _swap phase when _isNavigating is still true.
 */
export class AuthCallback {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallback')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			const state = user.state as AuthState | undefined
			if (state?.isSignUp) {
				this.logger.info('Sign-up detected, provisioning user in backend')
				await this.provisionUser(user.profile.email)
				return '/onboarding/discover'
			}

			return '/dashboard'
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				return '/dashboard'
			}

			// Let the component render with the error message
			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			return true
		}
	}

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
			if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
				this.logger.info('User already exists in backend, continuing...', {
					email,
				})
				return
			}

			this.logger.error('Failed to provision user in backend', {
				email,
				error: err,
			})
			throw err
		}
	}
}
