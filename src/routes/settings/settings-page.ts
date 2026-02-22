import { resolve } from 'aurelia'
import { IAuthService } from '../../services/auth-service'

export class SettingsPage {
	public readonly auth = resolve(IAuthService)

	public async signOut(): Promise<void> {
		await this.auth.signOut()
	}
}
