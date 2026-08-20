import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import type { User } from 'oidc-client-ts'
import type { IAuthService } from '../../shared/services/auth-service'

// Module-level guard so concurrent 401s trigger only ONE silent refresh.
// Zitadel rotates refresh tokens (each use invalidates the previous one), so
// parallel signinSilent() calls would race and all but the first would fail
// with RefreshTokenInvalid.
let refreshPromise: Promise<User | null> | null = null

/**
 * Admin Connect interceptor that recovers from an expired access token.
 *
 * The shared AuthService sets `automaticSilentRenew: false` (the background
 * renew timer is disabled because Zitadel's refresh-token rotation races a
 * service-worker-triggered page reload). Token refresh is therefore on-demand
 * only: at boot (`restoreSession`) and here, on an `Unauthenticated` RPC.
 *
 * The consumer transport already has the equivalent (`createAuthRetryInterceptor`
 * in `src/services/connect-error-router.ts`); the admin transport was missing
 * it, so once the admin's access token expired mid-session (Zitadel default
 * lifetime) every RPC failed with `unauthenticated: failed to validate token:
 * "exp" not satisfied` until a full page reload. This is an admin-local copy
 * rather than a shared import because admin code must not cross into the
 * consumer's `src/services/` (bundle-isolation rule), and the failure path
 * differs: admin restarts the OIDC flow via `auth.signIn()` (matching
 * `AdminAuthHook`) instead of the consumer's `/welcome` redirect.
 *
 * On `Unauthenticated`, it runs a single de-duplicated `signinSilent()` (uses
 * the `offline_access` refresh token via the token endpoint — no iframe),
 * retries the request once with the fresh token, and if the refresh fails,
 * clears the stale session and restarts sign-in.
 */
export const createAdminAuthRetryInterceptor = (
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
