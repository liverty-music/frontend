import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import { currentInAppLocation } from '../../shared/utils/return-to'
import type { IAuthService } from './auth-service'

/**
 * Creates a Connect interceptor that handles Unauthenticated errors by
 * attempting a silent token refresh (via the shared single-flight
 * {@link IAuthService.ensureFreshToken}) and retrying the original request
 * once. If the refresh fails and the user was previously authenticated, the
 * session is cleared gracefully (publishing `SignedOut` + preserving the
 * return-to location) and the user is sent to the landing page to
 * re-authenticate. Guest/onboarding users are never redirected because they
 * have no session to recover — their error propagates for local handling.
 */
export const createAuthRetryInterceptor = (auth: IAuthService): Interceptor => {
	return (next) => async (req) => {
		try {
			return await next(req)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			if (err.code !== Code.Unauthenticated) throw err

			// Guest/onboarding caller has no session to recover — propagate.
			if (!auth.user) {
				throw err
			}

			// Single-flight refresh shared with boot restore, resume, and any
			// concurrent 401s. Retry the original request ONCE with the new token.
			const user = await auth.ensureFreshToken()
			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
				try {
					return await next(req)
				} catch (retryErr) {
					// The retry is bounded to once. A non-auth failure is a genuine
					// downstream error — propagate it. A retried-still-Unauthenticated
					// (e.g. clock skew, immediate re-expiry) falls through to the
					// unrecoverable path rather than looping.
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
			// return-to, and send the user to re-authenticate. The single-shot latch
			// ensures only the first of N concurrent 401s performs the redirect.
			if (await auth.prepareForcedReauth(currentInAppLocation())) {
				window.location.href = '/welcome'
			}
			throw err
		}
	}
}

/**
 * Creates a Connect interceptor that retries transient errors
 * (Unavailable) with exponential backoff.
 * DeadlineExceeded is NOT retried — it indicates a long-running operation
 * (e.g. Gemini API) timed out, and retrying wastes ~60s per attempt.
 */
export const createRetryInterceptor = (maxRetries = 3): Interceptor => {
	const retryableCodes = new Set([Code.Unavailable])

	return (next) => async (req) => {
		let lastError: unknown
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await next(req)
			} catch (err) {
				lastError = err
				if (!(err instanceof ConnectError)) throw err
				if (!retryableCodes.has(err.code)) throw err
				if (attempt === maxRetries) throw err

				// Exponential backoff: 200ms, 400ms, 800ms
				const delay = 200 * 2 ** attempt
				await new Promise((resolve) => setTimeout(resolve, delay))
			}
		}
		throw lastError
	}
}
