import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * Admin OIDC callback handler. Deliberately minimal compared with the consumer
 * callback: it only completes the authorization-code exchange and routes to the
 * welcome page. The admin console has no guest-migration, user-provisioning, or
 * i18n hand-off — authentication itself is the access boundary (design D1).
 *
 * Uses `canLoad` to return a NavigationInstruction so the redirect happens
 * inside the router transition pipeline (the same pattern the consumer uses to
 * avoid a hang when routing from `attached()`).
 */
export class AuthCallbackRoute {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('AdminAuthCallbackRoute')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing admin OIDC callback...')
		try {
			await this.authService.handleCallback()
			this.logger.info('Admin auth callback succeeded')
			// After an involuntary re-auth, return the operator to where they were.
			return this.authService.takeReturnTo() ?? '/welcome'
		} catch (err) {
			this.logger.error('Admin auth callback error:', err)

			// If a prior callback already established the session, recover by
			// routing to welcome rather than showing an error.
			if (this.authService.isAuthenticated) {
				return this.authService.takeReturnTo() ?? '/welcome'
			}

			// Hard failure: discard any stored return-to so it can't be replayed by
			// a later, unrelated successful sign-in.
			this.authService.takeReturnTo()
			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			return true
		}
	}
}
