import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import type { IAuthService } from '../../shared/services/auth-service'
import { currentInAppLocation } from '../../shared/utils/return-to'

/**
 * Admin Connect interceptor that recovers from an expired access token.
 *
 * The shared AuthService sets `automaticSilentRenew: false` (the background
 * renew timer is disabled because Zitadel's refresh-token rotation races a
 * service-worker-triggered page reload). Token refresh is therefore on-demand:
 * at boot (`restoreSession`), on foreground resume (`visibilitychange`), and
 * here, on an `Unauthenticated` RPC. All of these share the single-flight
 * {@link IAuthService.ensureFreshToken}, so concurrent triggers perform at most
 * one `signinSilent()` — the direct antidote to the rotation race.
 *
 * This is an admin-local copy of the consumer's `createAuthRetryInterceptor`
 * rather than a shared import because admin code must not cross into the
 * consumer's `src/services/` (bundle-isolation rule), and the failure path
 * differs: admin restarts the OIDC flow via `auth.signIn()` (matching
 * `AdminAuthHook`) instead of the consumer's `/welcome` redirect.
 *
 * On `Unauthenticated`, it runs the single-flight refresh, retries the request
 * once with the fresh token, and if the refresh fails, clears the session
 * gracefully (`SignedOut` + return-to via {@link IAuthService.prepareForcedReauth})
 * and restarts sign-in.
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

			// Single-flight refresh (shared with boot restore, resume, concurrent
			// 401s). Retry the original request ONCE with the new token.
			const user = await auth.ensureFreshToken()
			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
				try {
					return await next(req)
				} catch (retryErr) {
					// Bounded to once. A non-auth failure propagates; a
					// retried-still-Unauthenticated falls through to forced re-auth.
					if (
						!(retryErr instanceof ConnectError) ||
						retryErr.code !== Code.Unauthenticated
					) {
						throw retryErr
					}
				}
			}

			// Unrecoverable (refresh token expired/invalid, or the retry still
			// returned Unauthenticated): clear the session gracefully — publish
			// SignedOut so stores self-clear, preserve return-to — then restart the
			// OIDC sign-in flow. The single-shot latch ensures only the first of N
			// concurrent 401s calls signIn() (a double signinRedirect races PKCE
			// state). Surface the original error so the in-flight call fails fast.
			if (await auth.prepareForcedReauth(currentInAppLocation())) {
				await auth.signIn()
			}
			throw err
		}
	}
}
