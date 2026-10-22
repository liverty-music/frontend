import type { NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../services/auth-service'
import {
	IPasskeyAuthService,
	PASSKEY_MANAGEMENT_PATH,
} from '../../services/passkey-auth-service'

/** Why opening passkey management did not complete. */
export type PasskeysCallbackFailure = 'failed' | 'otherAccount'

/**
 * Return leg of the passkey-management sign-in (`/auth/passkeys-callback`,
 * design D3). Completes the code exchange of the second OIDC client and opens
 * passkey management, or shows why it could not.
 *
 * Like the main auth callback, it resolves in canLoad so the router redirects
 * inside its own transition.
 */
export class PasskeysCallbackRoute {
	public failure: PasskeysCallbackFailure | null = null

	private readonly auth = resolve(IAuthService)
	private readonly passkeyAuth = resolve(IPasskeyAuthService)
	private readonly logger = resolve(ILogger).scopeTo('PasskeysCallbackRoute')

	public async canLoad(): Promise<boolean | NavigationInstruction> {
		try {
			const session = await this.passkeyAuth.handleCallback()
			await this.auth.ready
			// The hosted login lets the person pick another account. Passkey
			// management acts on the token's identity, so it must be the account
			// signed in to the app.
			if (session.userId !== this.auth.user?.profile.sub) {
				this.logger.warn('Passkey-management sign-in returned another account')
				this.passkeyAuth.discard()
				this.failure = 'otherAccount'
				return true
			}
			return PASSKEY_MANAGEMENT_PATH
		} catch (err) {
			this.logger.warn('Passkey-management sign-in did not complete', err)
			this.passkeyAuth.discard()
			this.failure = 'failed'
			return true
		}
	}
}
