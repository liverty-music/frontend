import type { ILogger } from 'aurelia'
import type { IAuthService } from '../../shared/services/auth-service'
import { tokenOrgIds } from './roles'

/**
 * sessionStorage flag recording that we already forced one re-authentication
 * because the authenticated session resolved to a different org than the
 * intended tenant (design D-D). Bounds the org-mismatch recovery to a single
 * attempt so a persistent mismatch fails closed instead of looping. Tab-scoped.
 */
export const ORG_MISMATCH_FLAG = 'liverty:organizer:org-mismatch-retry'

export function readSessionFlag(key: string): boolean {
	try {
		return window.sessionStorage.getItem(key) === '1'
	} catch {
		// Storage unavailable → treat as "already attempted" so we fail closed
		// rather than risk an unguarded redirect loop.
		return true
	}
}

export function setSessionFlag(key: string): void {
	try {
		window.sessionStorage.setItem(key, '1')
	} catch {
		// best-effort; readSessionFlag fails closed if the store is unavailable.
	}
}

export function clearSessionFlag(key: string): void {
	try {
		window.sessionStorage.removeItem(key)
	} catch {
		// best-effort
	}
}

/** Outcome of the intended-org gate. */
export type OrgGate = 'ok' | 'reauth' | 'denied'

/**
 * Enforces that the authenticated session belongs to the INTENDED tenant org
 * (`intendedOrg` — resolved from the `?org_id` the tenant login policy's default
 * redirect carries). This runs in the route guard so it covers BOTH the
 * fresh-callback path and the path where a pre-existing console session is
 * admitted WITHOUT a new OIDC exchange — a reused SSO session for a different
 * org would otherwise be silently accepted (the reproduced org-test-40 →
 * org-test-21 mix). Returns:
 * - `'ok'`: acceptable — the token belongs to the intended org, there is no
 *   intended org to enforce, or the token carries no org grant at all (a
 *   no-grant session is left for the owner-role gate to deny, not re-auth).
 *   Clears the one-shot flag.
 * - `'reauth'`: the token belongs to a DIFFERENT org (reused session), first
 *   attempt — re-auth started with `prompt=login`; the caller aborts nav.
 * - `'denied'`: still the wrong org after a prior re-auth — fail closed.
 */
export async function enforceIntendedOrg(
	authService: Pick<IAuthService, 'signIn'>,
	intendedOrg: string | undefined,
	profile: Record<string, unknown> | undefined,
	logger: ILogger,
): Promise<OrgGate> {
	const orgs = tokenOrgIds(profile)
	// Acceptable: nothing to enforce, the token is in the intended org, or the
	// token has no org grant (the owner-role gate denies that, not a re-auth).
	if (!intendedOrg || orgs.length === 0 || orgs.includes(intendedOrg)) {
		clearSessionFlag(ORG_MISMATCH_FLAG)
		return 'ok'
	}

	// The session belongs to a different org than intended (reused SSO session).
	if (!readSessionFlag(ORG_MISMATCH_FLAG)) {
		setSessionFlag(ORG_MISMATCH_FLAG)
		logger.info(
			'Authenticated org is not the intended tenant; forcing re-authentication',
		)
		await authService.signIn({ forceLogin: true })
		return 'reauth'
	}

	return 'denied'
}
