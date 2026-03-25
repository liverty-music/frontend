import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { codeToHome } from '../../constants/iso3166'
import { IAuthService } from '../../services/auth-service'
import { IGuestDataMergeService } from '../../services/guest-data-merge-service'
import { IGuestService } from '../../services/guest-service'
import { IUserService } from '../../services/user-service'

/**
 * OIDC callback handler that processes the authorization code exchange
 * and redirects to the appropriate destination.
 *
 * Uses canLoad() to return a NavigationInstruction, which the Aurelia Router
 * handles internally within the transition pipeline. This avoids calling
 * router.load() from attached(), which can hang because attached() fires
 * during the _swap phase when _isNavigating is still true.
 */
const POST_SIGNUP_FLAG = 'liverty:postSignup:shown'

export class AuthCallbackRoute {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly mergeService = resolve(IGuestDataMergeService)
	private readonly guest = resolve(IGuestService)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallbackRoute')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			const isNewUser = await this.ensureUserProvisioned(user.profile.email)

			// Merge any guest data accumulated during onboarding
			await this.mergeService.merge()

			// On first-time signup: set flag so dashboard shows PostSignupDialog
			if (isNewUser) {
				localStorage.setItem(POST_SIGNUP_FLAG, 'pending')
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

	// Load the user profile from the backend. If the user does not exist yet
	// (new registration), provision first. The Create RPC returns the user
	// entity which is cached by UserServiceClient, so no second Get is needed.
	// Returns true if this was a first-time signup (new user provisioned).
	private async ensureUserProvisioned(
		email: string | undefined,
	): Promise<boolean> {
		try {
			await this.userService.ensureLoaded()
			return false
		} catch (err) {
			if (!(err instanceof ConnectError && err.code === Code.NotFound)) {
				throw err
			}
			this.logger.info('User not found in backend, provisioning...')
		}

		const isNew = await this.provisionUser(email)
		// provisionUser swallows AlreadyExists without setting _current,
		// so fall back to a Get RPC if the cache is still empty.
		if (!this.userService.current) {
			await this.userService.ensureLoaded()
		}
		return isNew
	}

	// Call Create RPC with ALREADY_EXISTS handling.
	// If the guest selected a home during onboarding, include it in the
	// CreateRequest so it is persisted atomically with account creation.
	// Returns true if the user was newly created.
	private async provisionUser(email: string | undefined): Promise<boolean> {
		if (!email) {
			this.logger.error('User email is missing, cannot provision user')
			return false
		}

		try {
			const guestHome = this.guest.home
			await this.userService.create(
				email,
				guestHome ? codeToHome(guestHome) : undefined,
			)
			this.logger.info('User provisioned successfully', { email })
			return true
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
				this.logger.info('User already exists in backend, continuing...', {
					email,
				})
				return false
			}

			this.logger.error('Failed to provision user in backend', {
				email,
				error: err,
			})
			throw err
		}
	}
}
