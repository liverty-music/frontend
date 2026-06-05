import { resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * Post-login welcome placeholder for the admin console. Confirms the
 * authenticated foundation is in place; it exposes no business feature
 * (see OpenSpec change `add-admin-console`, "Post-login welcome placeholder").
 */
export class WelcomeRoute {
	private readonly authService = resolve(IAuthService)

	public get username(): string {
		const profile = this.authService.user?.profile
		return profile?.preferred_username ?? profile?.email ?? 'developer'
	}
}
