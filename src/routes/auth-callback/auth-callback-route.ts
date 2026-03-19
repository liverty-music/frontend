import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { codeToHome } from '../../constants/iso3166'
import { IAuthService } from '../../services/auth-service'
import { IGuestDataMergeService } from '../../services/guest-data-merge-service'
import { IUserService } from '../../services/user-service'
import { resolveStore } from '../../state/store-interface'

/**
 * OIDC callback handler that processes the authorization code exchange
 * and redirects to the appropriate destination.
 *
 * Uses canLoad() to return a NavigationInstruction, which the Aurelia Router
 * handles internally within the transition pipeline. This avoids calling
 * router.load() from attached(), which can hang because attached() fires
 * during the _swap phase when _isNavigating is still true.
 */
export class AuthCallbackRoute {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly mergeService = resolve(IGuestDataMergeService)
	private readonly store = resolveStore()
	private readonly logger = resolve(ILogger).scopeTo('AuthCallbackRoute')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			await this.ensureUserProvisioned(user.profile.email)

			// Merge any guest data accumulated during onboarding
			await this.mergeService.merge()

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
	// (new registration), provision first and then load.
	private async ensureUserProvisioned(
		email: string | undefined,
	): Promise<void> {
		try {
			await this.userService.ensureLoaded()
			return
		} catch (err) {
			if (!(err instanceof ConnectError && err.code === Code.NotFound)) {
				throw err
			}
			this.logger.info('User not found in backend, provisioning...')
		}

		await this.provisionUser(email)
		await this.userService.ensureLoaded()
	}

	// Call Create RPC with ALREADY_EXISTS handling.
	// If the guest selected a home during onboarding, include it in the
	// CreateRequest so it is persisted atomically with account creation.
	private async provisionUser(email: string | undefined): Promise<void> {
		if (!email) {
			this.logger.error('User email is missing, cannot provision user')
			return
		}

		try {
			const guestHome = this.store.getState().guest.home
			await this.userService.create(
				email,
				guestHome ? codeToHome(guestHome) : undefined,
			)
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
