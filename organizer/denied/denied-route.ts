import { resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * Shown to a signed-in account without the owner role: no console screen
 * opens, and the operator can sign out to try another account.
 */
export class DeniedRoute {
	private readonly auth = resolve(IAuthService)

	public async signOut(): Promise<void> {
		await this.auth.signOut()
	}
}
