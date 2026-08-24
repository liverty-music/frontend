import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'
import {
	clearSessionFlag,
	readSessionFlag,
	setSessionFlag,
} from '../hooks/org-enforcement'

/**
 * sessionStorage flag recording that we already restarted sign-in once from the
 * callback to recover a cross-context state miss (see `canLoad`). It bounds the
 * self-heal to a single attempt so a genuinely broken state store cannot loop
 * the operator between the console and Zitadel forever. Tab-scoped.
 */
export const CALLBACK_RETRY_FLAG = 'liverty:organizer:callback-retry'

/**
 * oidc-client-ts throws this message from `signinCallback` when the callback URL
 * carries a `state` whose entry is absent from storage — i.e. the originating
 * `signinRedirect` ran in a DIFFERENT browsing context (a duplicate invitation
 * link, a second tab, an earlier attempt in another profile), so this context's
 * localStorage never held that state. This specific failure is self-healable by
 * restarting sign-in here; other callback errors are not.
 */
function isRecoverableStateMiss(err: unknown): boolean {
	return (
		err instanceof Error &&
		/no matching state found in storage/i.test(err.message)
	)
}

/**
 * Organizer OIDC callback handler. Completes the authorization-code exchange and
 * routes to the welcome page. It does NOT enforce the intended org or the owner
 * role itself — the route guard (`OrganizerAuthHook`) does that when routing to
 * `/welcome`, which also covers the path where a pre-existing session is admitted
 * without a callback. The callback keeps only the cross-context state-miss
 * self-heal.
 *
 * Uses `canLoad` to return a NavigationInstruction so the redirect happens
 * inside the router transition pipeline (the same pattern the admin/consumer
 * entries use to avoid a hang when routing from `attached()`).
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
			// Clear the one-shot self-heal marker; the guard enforces org + role.
			clearSessionFlag(CALLBACK_RETRY_FLAG)
			return '/welcome'
		} catch (err) {
			this.logger.error('Organizer auth callback error:', err)

			// If a prior callback already established the session, route to welcome
			// (the guard re-checks the intended org and the owner role).
			if (this.authService.isAuthenticated) {
				clearSessionFlag(CALLBACK_RETRY_FLAG)
				return '/welcome'
			}

			// Self-heal a cross-context "No matching state" dead-end: restart the
			// OIDC flow ONCE from this context so `signinRedirect` writes a fresh
			// state here. The operator typically still holds a Zitadel session
			// (they just authenticated), so this round-trips back without another
			// credential prompt and lands a callback whose state IS in this
			// context's storage. Bounded to one attempt via the sessionStorage flag.
			if (
				isRecoverableStateMiss(err) &&
				!readSessionFlag(CALLBACK_RETRY_FLAG)
			) {
				setSessionFlag(CALLBACK_RETRY_FLAG)
				this.logger.info(
					'Callback state missing in this context; restarting sign-in once',
				)
				await this.authService.signIn()
				return false
			}

			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			return true
		}
	}
}
