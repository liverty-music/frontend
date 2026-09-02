import type { Interceptor } from '@connectrpc/connect'
import { createTokenRefreshInterceptor } from '../../shared/services/auth-retry-interceptor'
import type { IAuthService } from '../../shared/services/auth-service'

/**
 * Admin auth-retry interceptor. Delegates the shared refresh/retry mechanics to
 * {@link createTokenRefreshInterceptor}; the admin specific is its
 * unrecoverable-expiry action — restart the OIDC flow via `auth.signIn()`
 * (matching `AdminAuthHook`) instead of the consumer's `/welcome` redirect.
 * Admin has no guest mode, so an authenticated-only 401 always attempts
 * recovery.
 */
export const createAdminAuthRetryInterceptor = (
	auth: IAuthService,
): Interceptor =>
	createTokenRefreshInterceptor(auth, {
		onUnrecoverable: () => auth.signIn(),
	})
