import { resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * Post-login welcome placeholder for the organizer console. Confirms the
 * access-controlled shell is in place; it exposes no business feature (business
 * screens land in later changes). Reached only by an authenticated operator
 * holding the `owner` role (see {@link ../hooks/auth-hook}).
 */
export class WelcomeRoute {
	private readonly authService = resolve(IAuthService)

	public get username(): string {
		const profile = this.authService.user?.profile
		return profile?.preferred_username ?? profile?.email ?? 'organizer'
	}
}
