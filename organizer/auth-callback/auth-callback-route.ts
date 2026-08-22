import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../shared/services/auth-service'

/**
 * sessionStorage flag recording that we already restarted sign-in once from the
 * callback to recover a cross-context state miss (see `canLoad`). It bounds the
 * self-heal to a single attempt so a genuinely broken state store cannot loop
 * the operator between the console and Zitadel forever. sessionStorage (not
 * localStorage) so it is scoped to the tab and clears when the tab closes.
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

function readRetryFlag(): boolean {
	try {
		return window.sessionStorage.getItem(CALLBACK_RETRY_FLAG) === '1'
	} catch {
		// Storage unavailable → treat as "already retried" so we fail closed to
		// the error page rather than risk an unguarded redirect loop.
		return true
	}
}

function setRetryFlag(): void {
	try {
		window.sessionStorage.setItem(CALLBACK_RETRY_FLAG, '1')
	} catch {
		// best-effort; readRetryFlag fails closed if the store is unavailable.
	}
}

function clearRetryFlag(): void {
	try {
		window.sessionStorage.removeItem(CALLBACK_RETRY_FLAG)
	} catch {
		// best-effort
	}
}

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
			// Clear the one-shot retry marker so a later legitimate sign-in in the
			// same tab can self-heal again if it ever needs to.
			clearRetryFlag()
			return '/welcome'
		} catch (err) {
			this.logger.error('Organizer auth callback error:', err)

			// If a prior callback already established the session, recover by
			// routing to welcome (the guard re-checks the owner role) rather than
			// showing an error.
			if (this.authService.isAuthenticated) {
				clearRetryFlag()
				return '/welcome'
			}

			// Self-heal a cross-context "No matching state" dead-end: restart the
			// OIDC flow ONCE from this context so `signinRedirect` writes a fresh
			// state here. The operator typically still holds a Zitadel session
			// (they just authenticated), so this round-trips back without another
			// credential prompt and lands a callback whose state IS in this
			// context's storage. Bounded to one attempt via the sessionStorage flag.
			if (isRecoverableStateMiss(err) && !readRetryFlag()) {
				setRetryFlag()
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
