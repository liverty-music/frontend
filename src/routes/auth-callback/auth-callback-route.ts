import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { codeToHome } from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
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
				localStorage.setItem(StorageKeys.postSignupShown, 'pending')
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

	// Resolve the caller's internal user_id and cache it. Cache hit → call Get.
	// Cache miss (fresh device, sign-up, or cleared storage) → call Create,
	// which is now idempotent on duplicate external_id and returns either the
	// newly created or existing user.
	//
	// Returns true when the response represents a fresh signup (no cached
	// user_id existed before this call AND home was supplied from the guest
	// onboarding flow — best-effort heuristic since the backend no longer
	// distinguishes new vs. existing on the wire).
	private async ensureUserProvisioned(
		email: string | undefined,
	): Promise<boolean> {
		const loaded = await this.userService.ensureLoaded()
		if (loaded) {
			return false
		}
		return this.provisionUser(email)
	}

	// Call the (now idempotent) Create RPC. If the guest selected a home
	// during onboarding, include it so it is persisted atomically with the
	// user record. Returns true if this looks like a fresh signup.
	private async provisionUser(email: string | undefined): Promise<boolean> {
		if (!email) {
			this.logger.error('User email is missing, cannot provision user')
			return false
		}

		try {
			const guestHome = this.guest.home
			const created = await this.userService.create(
				email,
				guestHome ? codeToHome(guestHome) : undefined,
			)
			this.logger.info('User provisioned (or returned existing)', { email })
			// guestHome is only present during the new-signup onboarding flow.
			// Its presence is a reliable signal that this session represents a
			// first-time signup; returning users on a fresh device do not have a
			// guest profile in localStorage.
			return Boolean(created) && Boolean(guestHome)
		} catch (err) {
			this.logger.error('Failed to provision user in backend', {
				email,
				error: err,
			})
			throw err
		}
	}
}
