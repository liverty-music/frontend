import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { UserEmail } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { IGuestDataMergeService } from '../services/guest-data-merge-service'
import {
	IOnboardingService,
	OnboardingStep,
} from '../services/onboarding-service'
import { IUserService } from '../services/user-service'

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
	public isMerging = false

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly mergeService = resolve(IGuestDataMergeService)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallback')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			// Detect tutorial-originated signup via onboardingStep (not OIDC state)
			const isTutorialSignup =
				this.onboarding.currentStep === OnboardingStep.SIGNUP

			if (isTutorialSignup) {
				this.logger.info(
					'Tutorial signup detected, provisioning user and merging guest data',
				)
				await this.provisionUser(user.profile.email)

				this.isMerging = true
				await this.mergeService.merge()
				this.isMerging = false

				return '/dashboard'
			}

			// Login flow (from LP login link or returning user)
			await this.provisionUser(user.profile.email)

			// If onboarding was in progress but user logged in, mark as completed
			if (this.onboarding.isOnboarding) {
				this.onboarding.complete()
			}

			return '/dashboard'
		} catch (err) {
			this.logger.error('Auth callback error:', err)
			this.isMerging = false

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

	// Call Create RPC with ALREADY_EXISTS handling
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
