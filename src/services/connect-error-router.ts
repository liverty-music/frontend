import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import type { IAuthService } from './auth-service'

/**
 * Creates a Connect interceptor that handles Unauthenticated errors
 * by attempting a silent token refresh and retrying the original request.
 * If the refresh fails and the user was previously authenticated, they are
 * redirected to the landing page. Guest/onboarding users are never redirected
 * because they have no session to recover.
 */
export const createAuthRetryInterceptor = (auth: IAuthService): Interceptor => {
	return (next) => async (req) => {
		try {
			return await next(req)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			if (err.code !== Code.Unauthenticated) throw err

			// If the user was never authenticated (guest/onboarding mode),
			// skip silent refresh and redirect — just propagate the error
			// so the caller can handle it gracefully.
			if (!auth.user) {
				throw err
			}

			// Attempt silent token refresh via OIDC signinSilent
			try {
				const user = await auth.getUserManager().signinSilent()
				if (user?.access_token) {
					req.header.set('Authorization', `Bearer ${user.access_token}`)
					return await next(req)
				}
			} catch {
				// Silent refresh failed — redirect to login
			}

			// Clear auth state and redirect to landing page
			await auth.getUserManager().removeUser()
			window.location.href = '/welcome'
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
