import { I18N } from '@aurelia/i18n'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'
import { currentLanguage } from '../util/change-locale'

export class AuthStatus {
	public readonly auth = resolve(IAuthService)
	private readonly i18n = resolve(I18N)
	private readonly logger = resolve(ILogger).scopeTo('AuthStatus')

	public async signIn(): Promise<void> {
		this.logger.debug('Sign In clicked')
		await this.auth.signIn({ uiLocales: currentLanguage(this.i18n) })
	}

	public async signUp(): Promise<void> {
		this.logger.debug('Sign Up clicked')
		await this.auth.signUp({ uiLocales: currentLanguage(this.i18n) })
	}

	public async signOut(): Promise<void> {
		this.logger.debug('Sign Out clicked')
		// AuthService publishes SignedOut before the redirect; every store
		// (UserStore included) clears its own state on it.
		await this.auth.signOut()
	}
}
