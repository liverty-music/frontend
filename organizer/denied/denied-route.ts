import type { RouteNode } from '@aurelia/router'
import { resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * A page that opens no console screen and offers サインアウト to switch
 * accounts: for a signed-in account without the owner role (`denied`), and for
 * an address that names another Organizer (`other-organizer`, design D1). The
 * route's `data.reason` picks the text.
 */
export class DeniedRoute {
	private readonly auth = resolve(IAuthService)

	public titleKey = 'denied.title'
	public bodyKey = 'denied.body'

	public loading(_params: unknown, next: RouteNode): void {
		const other = next.data?.reason === 'otherOrganizer'
		this.titleKey = other ? 'otherOrganizer.title' : 'denied.title'
		this.bodyKey = other ? 'otherOrganizer.body' : 'denied.body'
	}

	public async signOut(): Promise<void> {
		await this.auth.signOut()
	}
}
