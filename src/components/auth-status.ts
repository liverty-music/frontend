import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { IUserService } from '../services/user-service'

export class AuthStatus {
	public readonly auth = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly logger = resolve(ILogger).scopeTo('AuthStatus')

	public async signIn(): Promise<void> {
		this.logger.debug('Sign In clicked')
		await this.auth.signIn()
	}

	public async signUp(): Promise<void> {
		this.logger.debug('Sign Up clicked')
		await this.auth.signUp()
	}

	public async signOut(): Promise<void> {
		this.logger.debug('Sign Out clicked')
		// Drop the cached user_id (and in-memory current user) BEFORE the
		// signoutRedirect so the localStorage entry does not outlive the
		// session — mirrors the pattern in settings-route.signOut(). Required
		// by the user-account-sync spec scenario "Cached userID is cleared on
		// sign-out".
		this.userService.clear()
		await this.auth.signOut()
	}
}
