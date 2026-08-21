import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * Organizer OIDC callback handler. Deliberately minimal: it only completes the
 * authorization-code exchange and routes to the welcome page. The organizer
 * console has no guest-migration, user-provisioning, or i18n hand-off — the
 * route guard enforces the `owner` role once a session exists (design D2).
 *
 * Uses `canLoad` to return a NavigationInstruction so the redirect happens
 * inside the router transition pipeline (the same pattern the admin/consumer
 * entries use to avoid a hang when routing from `attached()`). Routing to
 * `/welcome` re-runs the guard, which applies the owner-role check.
 */
export class AuthCallbackRoute {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo(
		'OrganizerAuthCallbackRoute',
	)

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing organizer OIDC callback...')
		try {
			await this.authService.handleCallback()
			this.logger.info('Organizer auth callback succeeded')
			// After an involuntary re-auth, return the operator to where they were.
			return this.authService.takeReturnTo() ?? '/welcome'
		} catch (err) {
			this.logger.error('Organizer auth callback error:', err)

			// If a prior callback already established the session, recover by
			// routing to welcome (the guard re-checks the owner role) rather than
			// showing an error.
			if (this.authService.isAuthenticated) {
				return this.authService.takeReturnTo() ?? '/welcome'
			}

			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			return true
		}
	}
}
