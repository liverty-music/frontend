import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../services/auth-service'

export class AuthStatus {
	public readonly auth = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('AuthStatus')

	public async signIn(): Promise<void> {
		this.logger.debug('Sign In clicked')
		await this.auth.signIn()
	}

	public async signUp(): Promise<void> {
		this.logger.debug('Sign Up clicked')
		await this.auth.register()
	}

	public async signOut(): Promise<void> {
		this.logger.debug('Sign Out clicked')
		await this.auth.signOut()
	}
}
