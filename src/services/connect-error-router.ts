import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import { createTokenRefreshInterceptor } from '../../shared/services/auth-retry-interceptor'
import type { IAuthService } from './auth-service'

/**
 * Consumer auth-retry interceptor. Delegates the shared refresh/retry mechanics
 * to {@link createTokenRefreshInterceptor}; the consumer specifics are its
 * guest/onboarding mode (401s without a session propagate for local handling)
 * and its unrecoverable-expiry redirect to the landing page.
 */
export const createAuthRetryInterceptor = (auth: IAuthService): Interceptor =>
	createTokenRefreshInterceptor(auth, {
		propagateWhenNoUser: true,
		onUnrecoverable: () => {
			window.location.href = '/welcome'
		},
	})

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
