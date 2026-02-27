import { I18N } from '@aurelia/i18n'
import { bindable, ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../services/auth-service'

export class SignupModal {
	@bindable public active = false

	public isSigningUp = false
	public signUpError = ''

	private readonly authService = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('SignupModal')
	private readonly i18n = resolve(I18N)

	public async handleSignUp(): Promise<void> {
		if (this.isSigningUp) return

		this.isSigningUp = true
		this.signUpError = ''

		try {
			this.logger.info('Tutorial signup: initiating Passkey registration')
			await this.authService.signUp()
			// signUp redirects to Zitadel, so we won't reach here normally
		} catch (err) {
			this.logger.error('Signup failed', { error: err })
			this.signUpError = this.i18n.tr('signup.error')
			this.isSigningUp = false
		}
	}
}
