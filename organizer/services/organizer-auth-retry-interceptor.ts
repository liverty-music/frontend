import type { Interceptor } from '@connectrpc/connect'
import { createTokenRefreshInterceptor } from '../../shared/services/auth-retry-interceptor'
import type { IAuthService } from '../../shared/services/auth-service'

/**
 * Organizer auth-retry interceptor. Delegates the shared refresh/retry mechanics
 * to {@link createTokenRefreshInterceptor}; the organizer specific is its
 * unrecoverable-expiry action — restart the OIDC flow via `auth.signIn()`
 * (matching `OrganizerAuthHook`). Organizer has no guest mode, so an
 * authenticated-only 401 always attempts recovery.
 *
 * Using the shared core (rather than a private module-level refresh guard) is
 * what unifies the organizer's on-demand refresh with the boot restore and the
 * foreground-resume refresh through the single `IAuthService.ensureFreshToken`
 * single-flight — without it, a resume-time refresh and an organizer 401 could
 * fire two concurrent `signinSilent()` calls and race Zitadel's refresh-token
 * rotation.
 */
export const createOrganizerAuthRetryInterceptor = (
	auth: IAuthService,
): Interceptor =>
	createTokenRefreshInterceptor(auth, {
		onUnrecoverable: () => auth.signIn(),
	})
