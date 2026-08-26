import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import type { User } from 'oidc-client-ts'
import type { IAuthService } from '../../shared/services/auth-service'

// Module-level guard so concurrent 401s trigger only ONE silent refresh.
// Zitadel rotates refresh tokens (each use invalidates the previous one), so
// parallel signinSilent() calls would race and all but the first would fail
// with RefreshTokenInvalid.
let refreshPromise: Promise<User | null> | null = null

/**
 * Organizer Connect interceptor that recovers from an expired access token.
 *
 * The shared AuthService sets `automaticSilentRenew: false` (the background
 * renew timer is disabled because Zitadel's refresh-token rotation races a
 * service-worker-triggered page reload). Token refresh is therefore on-demand
 * only: at boot (`restoreSession`) and here, on an `Unauthenticated` RPC.
 *
 * This is an organizer-local copy of the admin console's interceptor rather
 * than a shared import: organizer code must not cross into the consumer's
 * `src/services/` or the sibling `admin/` bundle (bundle-isolation /
 * import-boundary rule — organizer code may only cross into `shared/`).
 *
 * On `Unauthenticated`, it runs a single de-duplicated `signinSilent()` (uses
 * the `offline_access` refresh token via the token endpoint — no iframe),
 * retries the request once with the fresh token, and if the refresh fails,
 * clears the stale session and restarts sign-in (matching `OrganizerAuthHook`).
 */
export const createOrganizerAuthRetryInterceptor = (
	auth: IAuthService,
): Interceptor => {
	return (next) => async (req) => {
		try {
			return await next(req)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			if (err.code !== Code.Unauthenticated) throw err

			if (refreshPromise === null) {
				refreshPromise = auth
					.getUserManager()
					.signinSilent()
					.catch(() => null)
					.finally(() => {
						refreshPromise = null
					})
			}
			const user = await refreshPromise

			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
				return await next(req)
			}

			// Silent refresh failed (e.g. refresh token expired): clear the stale
			// session and restart the OIDC sign-in flow, then surface the original
			// error so the in-flight call fails fast rather than hanging.
			await auth.getUserManager().removeUser()
			await auth.signIn()
			throw err
		}
	}
}
