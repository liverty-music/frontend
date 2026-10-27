import type { NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../services/auth-service'
import {
	FRESH_SIGN_IN_SCREENS,
	FreshSignInError,
	type FreshSignInScreen,
	IFreshSignInService,
} from '../../services/fresh-sign-in-service'

/** Why opening passkey management did not complete. */
export type PasskeysCallbackFailure = 'failed' | 'otherAccount'

/**
 * Return leg of the fresh sign-in (`/auth/passkeys-callback`; OpenSpec changes
 * `fan-passkey-recovery-and-management` design D3 and `delete-fan-accounts`
 * design D4). Completes the code exchange of the second OIDC client and opens
 * the screen the sign-in was started for, read from its request state.
 *
 * When the sign-in fails or names another account, passkey management's
 * failure is shown here; the withdrawal screen is opened instead, and says
 * itself that the account was not deleted.
 *
 * Like the main auth callback, it resolves in canLoad so the router redirects
 * inside its own transition.
 */
export class PasskeysCallbackRoute {
	public failure: PasskeysCallbackFailure | null = null

	private readonly auth = resolve(IAuthService)
	private readonly freshSignIn = resolve(IFreshSignInService)
	private readonly logger = resolve(ILogger).scopeTo('PasskeysCallbackRoute')

	public async canLoad(): Promise<boolean | NavigationInstruction> {
		let returnTo: FreshSignInScreen = 'passkeys'
		try {
			const session = await this.freshSignIn.handleCallback()
			returnTo = session.returnTo
			await this.auth.ready
			// The hosted login lets the person pick another account. Both screens
			// act on the token's identity, so it must be the account signed in to
			// the app.
			if (session.userId !== this.auth.user?.profile.sub) {
				this.logger.warn('Fresh sign-in returned another account', {
					returnTo,
				})
				this.freshSignIn.discard()
				return this.fail(returnTo, 'otherAccount')
			}
			return FRESH_SIGN_IN_SCREENS[returnTo]
		} catch (err) {
			if (err instanceof FreshSignInError) returnTo = err.returnTo
			this.logger.warn('Fresh sign-in did not complete', { returnTo, err })
			this.freshSignIn.discard()
			return this.fail(returnTo, 'failed')
		}
	}

	private fail(
		returnTo: FreshSignInScreen,
		failure: PasskeysCallbackFailure,
	): boolean | NavigationInstruction {
		if (returnTo === 'deleteAccount') return FRESH_SIGN_IN_SCREENS.deleteAccount
		this.failure = failure
		return true
	}
}
