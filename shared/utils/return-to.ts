/**
 * The current in-app location (path + query) to return the user to after an
 * involuntary re-authentication. Returns `undefined` for locations that must
 * NOT be returned to — the OIDC callback route (a transient redirect target)
 * and the landing page (the default destination anyway) — so the auth callback
 * falls back to its normal routing instead of bouncing back to a dead end.
 */
export function currentInAppLocation(): string | undefined {
	if (typeof window === 'undefined') return undefined
	const { pathname, search } = window.location
	if (pathname.startsWith('/auth/callback')) return undefined
	if (pathname === '/' || pathname === '/welcome') return undefined
	return `${pathname}${search}`
}
