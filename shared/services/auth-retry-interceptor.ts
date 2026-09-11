import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import { currentInAppLocation } from '../utils/return-to'
import type { IAuthService } from './auth-service'

/**
 * Per-entry customization for {@link createTokenRefreshInterceptor}. The refresh
 * mechanics (single-flight refresh, retry-once, graceful forced re-auth) are
 * identical across the consumer, admin, and organizer entries — only the guest
 * policy and the terminal redirect differ, so those are the only knobs.
 */
export interface TokenRefreshOptions {
	/**
	 * Propagate `Unauthenticated` WITHOUT refreshing when there is no stored user.
	 * The consumer sets this because it has a guest/onboarding mode whose 401s are
	 * handled locally (there is no session to recover). Admin and organizer have
	 * no guest state, so they leave it unset and always attempt recovery.
	 */
	propagateWhenNoUser?: boolean
	/**
	 * Terminal action for an unrecoverable expiry (the refresh token itself is
	 * invalid, or the retried request is still `Unauthenticated`). Runs for the
	 * FIRST of N concurrent 401s only — {@link IAuthService.prepareForcedReauth}'s
	 * single-shot latch gates it, so a double `signinRedirect()` cannot race PKCE
	 * state. Typically a full-page redirect (`/welcome`) or `auth.signIn()`.
	 */
	onUnrecoverable: () => void | Promise<void>
}

/**
 * Shared factory for the auth-retry Connect interceptor used by every app entry.
 *
 * The shared AuthService sets `automaticSilentRenew: false` (the background
 * renew timer is disabled because Zitadel's refresh-token rotation races a
 * service-worker-triggered page reload). Token refresh is therefore on-demand:
 * at boot (`restoreSession`), on foreground resume (`visibilitychange`), and
 * here, on an `Unauthenticated` RPC. All of these share the single-flight
 * {@link IAuthService.ensureFreshToken}, so concurrent triggers perform at most
 * one `signinSilent()` — the direct antidote to the rotation race.
 *
 * On `Unauthenticated`, it runs the single-flight refresh, retries the request
 * ONCE with the fresh token, and — if the refresh yields no usable token, or the
 * retry is *still* `Unauthenticated` — clears the session gracefully via
 * {@link IAuthService.prepareForcedReauth} (publishes `SignedOut` so
 * user-specific stores self-clear + preserves the return-to location) and runs
 * {@link TokenRefreshOptions.onUnrecoverable}.
 *
 * Any OTHER error from the retried request is a genuine downstream failure and
 * is propagated unchanged — this deliberately INCLUDES a `DeadlineExceeded` /
 * `Canceled` abort from the shared client-side call deadline (see
 * `frontend-network-timeouts`). Such an abort is a timeout, not an auth failure:
 * the just-refreshed token is presumed valid, so surfacing the timeout is
 * correct, and forcing a sign-out on it would wrongly eject a user with a
 * healthy session on a slow network. A truly dead session re-enters this path
 * (and recovers gracefully) on the next RPC, resume, or boot restore.
 *
 * Each entry (consumer `src/`, admin `admin/`, organizer `organizer/`) wraps
 * this with its own options and re-exports under an entry-specific name. Keeping
 * the mechanics here — rather than copied per entry — means a fix to the refresh
 * or retry semantics lands once for all three, closing the divergence that let
 * one entry drift onto a private, un-unified refresh guard.
 */
export const createTokenRefreshInterceptor = (
	auth: IAuthService,
	options: TokenRefreshOptions,
): Interceptor => {
	return (next) => async (req) => {
		try {
			return await next(req)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			if (err.code !== Code.Unauthenticated) throw err

			// Guest/onboarding caller has no session to recover — propagate.
			if (options.propagateWhenNoUser && !auth.user) throw err

			// Single-flight refresh shared with boot restore, resume, and any
			// concurrent 401s. Retry the original request ONCE with the new token.
			const user = await auth.ensureFreshToken()
			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
				try {
					return await next(req)
				} catch (retryErr) {
					// The retry is bounded to once. A non-auth failure is a genuine
					// downstream error — propagate it. This includes a `DeadlineExceeded`
					// / `Canceled` abort from the shared call deadline: that is a timeout
					// on a just-refreshed (presumed-valid) token, NOT an auth failure, so
					// it must NOT trigger a forced sign-out. Only a retried-still-
					// `Unauthenticated` (e.g. clock skew, immediate re-expiry) falls
					// through to the unrecoverable path rather than looping.
					if (
						!(retryErr instanceof ConnectError) ||
						retryErr.code !== Code.Unauthenticated
					) {
						throw retryErr
					}
				}
			}

			// Unrecoverable (refresh token expired/invalid, or the retry still
			// returned Unauthenticated): clear the session the same way a voluntary
			// sign-out does (publish SignedOut so stores self-clear), preserve
			// return-to, and hand off to the entry-specific terminal action. The
			// single-shot latch ensures only the first of N concurrent 401s runs it.
			if (await auth.prepareForcedReauth(currentInAppLocation())) {
				try {
					await options.onUnrecoverable()
				} catch {
					// The terminal hand-off failed to navigate away (e.g.
					// signinRedirect() rejected, or a CSP blocked the redirect). Release
					// the latch so a later 401 can retry the hand-off rather than leaving
					// the app signed-out-but-mounted forever, and fall through to rethrow
					// the ORIGINAL Unauthenticated error (not the hand-off failure) so
					// the in-flight caller's error handling stays consistent.
					auth.releaseForcedReauthLatch()
				}
			}
			throw err
		}
	}
}
