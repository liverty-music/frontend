import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { tokenGrantsOwnerInOrg } from '../hooks/roles'

/**
 * sessionStorage flag recording that we already restarted sign-in once from the
 * callback to recover a cross-context state miss (see `canLoad`). It bounds the
 * self-heal to a single attempt so a genuinely broken state store cannot loop
 * the operator between the console and Zitadel forever. sessionStorage (not
 * localStorage) so it is scoped to the tab and clears when the tab closes.
 */
export const CALLBACK_RETRY_FLAG = 'liverty:organizer:callback-retry'

/**
 * sessionStorage flag recording that we already forced one re-authentication
 * because the authenticated session resolved to a different org than the
 * intended tenant (design D-D). Bounds the org-mismatch recovery to a single
 * attempt so a persistent mismatch fails closed instead of looping.
 */
export const ORG_MISMATCH_FLAG = 'liverty:organizer:org-mismatch-retry'

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

function readFlag(key: string): boolean {
	try {
		return window.sessionStorage.getItem(key) === '1'
	} catch {
		// Storage unavailable → treat as "already attempted" so we fail closed to
		// the error page rather than risk an unguarded redirect loop.
		return true
	}
}

function setFlag(key: string): void {
	try {
		window.sessionStorage.setItem(key, '1')
	} catch {
		// best-effort; readFlag fails closed if the store is unavailable.
	}
}

function clearFlag(key: string): void {
	try {
		window.sessionStorage.removeItem(key)
	} catch {
		// best-effort
	}
}

/**
 * Organizer OIDC callback handler. Completes the authorization-code exchange,
 * enforces the authenticated session is the intended tenant, and routes to the
 * welcome page. The route guard applies the `owner` role check once a session
 * exists (design D2).
 *
 * Uses `canLoad` to return a NavigationInstruction so the redirect happens
 * inside the router transition pipeline (the same pattern the admin/consumer
 * entries use to avoid a hang when routing from `attached()`). Routing to
 * `/welcome` re-runs the guard, which applies the owner-role check.
 */
export class AuthCallbackRoute {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly config = resolve(IAppConfig)
	private readonly logger = resolve(ILogger).scopeTo(
		'OrganizerAuthCallbackRoute',
	)

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing organizer OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('Organizer auth callback succeeded')

			const orgResult = await this.enforceIntendedOrg(
				user.profile as Record<string, unknown>,
			)
			if (orgResult !== null) {
				return orgResult
			}

			// Success and the org matches — clear the one-shot recovery markers so
			// a later legitimate sign-in in the same tab can recover again if needed.
			clearFlag(CALLBACK_RETRY_FLAG)
			clearFlag(ORG_MISMATCH_FLAG)
			return '/welcome'
		} catch (err) {
			this.logger.error('Organizer auth callback error:', err)

			// If a prior callback already established the session, still enforce the
			// intended org before routing to welcome.
			if (this.authService.isAuthenticated) {
				const orgResult = await this.enforceIntendedOrg(
					this.authService.user?.profile as Record<string, unknown> | undefined,
				)
				if (orgResult !== null) {
					return orgResult
				}
				clearFlag(CALLBACK_RETRY_FLAG)
				clearFlag(ORG_MISMATCH_FLAG)
				return '/welcome'
			}

			// Self-heal a cross-context "No matching state" dead-end: restart the
			// OIDC flow ONCE from this context so `signinRedirect` writes a fresh
			// state here. The operator typically still holds a Zitadel session
			// (they just authenticated), so this round-trips back without another
			// credential prompt and lands a callback whose state IS in this
			// context's storage. Bounded to one attempt via the sessionStorage flag.
			if (isRecoverableStateMiss(err) && !readFlag(CALLBACK_RETRY_FLAG)) {
				setFlag(CALLBACK_RETRY_FLAG)
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

	/**
	 * Enforces that the authenticated token grants `owner` in the INTENDED tenant
	 * org (`config.zitadelOrgId`, resolved from the `?org_id` that the tenant
	 * login policy's default redirect carries). A reused SSO session for a
	 * different org authenticates successfully but fails this check; rather than
	 * admitting the wrong operator, re-authenticate ONCE with `prompt=login` so
	 * the operator signs in as the correct tenant (design D-D). Returns:
	 * - `null` when the org is acceptable (or there is no intended org to enforce)
	 * - `false` to abort the nav (the browser redirects to Zitadel to re-auth)
	 * - `true` to render the terminal error (already retried once, still wrong)
	 */
	private async enforceIntendedOrg(
		profile: Record<string, unknown> | undefined,
	): Promise<boolean | null> {
		const intendedOrg = this.config.zitadelOrgId
		if (!intendedOrg || tokenGrantsOwnerInOrg(profile, intendedOrg)) {
			return null
		}

		if (!readFlag(ORG_MISMATCH_FLAG)) {
			setFlag(ORG_MISMATCH_FLAG)
			this.logger.info(
				'Authenticated org is not the intended tenant; forcing re-authentication',
			)
			await this.authService.signIn({ forceLogin: true })
			return false
		}

		this.error =
			'Signed in to the wrong organization. Please reopen the invitation link.'
		return true
	}
}
