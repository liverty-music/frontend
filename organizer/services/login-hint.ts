import { DI } from 'aurelia'

/**
 * DI token for the `login_hint` resolved from the entry URL. Present only on
 * first sign-in: the organizer-accounts provisioner embeds it in the
 * invitation link as `?login_hint=<email>` so Zitadel can pre-fill the
 * operator's email address in the login form, skipping the manual entry step.
 *
 * Returns `null` for returning operators whose invitation link is no longer
 * in the URL (they already have an established passkey session). The auth hook
 * passes the value to `AuthService.signIn()`, which forwards it as the OIDC
 * `login_hint` parameter only when non-null.
 */
export const ILoginHint = DI.createInterface<string | null>('ILoginHint')

/**
 * Reads the `login_hint` query parameter from a URL search string and trims
 * surrounding whitespace. Returns `null` when absent or blank.
 */
export function readLoginHintFromSearch(search: string): string | null {
	const value = new URLSearchParams(search).get('login_hint')?.trim()
	return value || null
}
