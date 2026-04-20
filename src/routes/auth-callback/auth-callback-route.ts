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

	// Resolve the caller's internal user_id and cache it.
	//
	// When the guest selected a home during onboarding, we MUST take the
	// explicit-Create path so the home is persisted atomically with the user
	// record (idempotent Create on the backend ignores `home` for existing
	// users, so this is also safe for sign-in-as-existing).
	//
	// Otherwise UserService.ensureLoaded() handles everything: cache hit →
	// Get, cache miss → idempotent Create using the JWT email.
	//
	// Returns true when this session looks like a first-time signup. The
	// presence of guestHome (set only during the onboarding flow before
	// account creation) is a reliable proxy.
	private async ensureUserProvisioned(
		email: string | undefined,
	): Promise<boolean> {
		const guestHome = this.guest.home
		if (guestHome && email) {
			await this.userService.create(email, codeToHome(guestHome))
			return true
		}

		await this.userService.ensureLoaded()
		return false
	}
}
