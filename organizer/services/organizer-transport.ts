import type { Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import type { ILogger } from 'aurelia'
import type { AppConfig } from '../../shared/config/app-config'
import type { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerAuthRetryInterceptor } from './organizer-auth-retry-interceptor'

/**
 * Creates a Connect transport for the organizer console with authentication,
 * token-refresh-on-401, and logging interceptors.
 *
 * Deliberately organizer-local and minimal: it must NOT import the consumer's
 * `src/services/grpc-transport.ts` nor the sibling admin transport
 * (bundle-isolation / import-boundary rule — organizer code may only cross into
 * `shared/`). It keeps the three interceptors an organizer reviewer needs:
 * bearer-token injection, request/response logging, and
 * silent-refresh-and-retry on `Unauthenticated`. The auth-retry interceptor is
 * required because the shared AuthService disables background silent-renew
 * (`automaticSilentRenew: false`); without it an expired access token is resent
 * indefinitely and every organizer RPC fails with `unauthenticated: "exp" not
 * satisfied` until a full page reload.
 *
 * Accepts `IAuthService`, `ILogger`, and `AppConfig` as parameters rather than
 * calling `resolve()` internally so it can run outside a DI resolution context
 * without triggering AUR0002 (mirrors the consumer/admin transport factories).
 *
 * The organizer Connect server is served by the dedicated organizer API host.
 * The runtime `config.json` points `apiBaseUrl` at that host for the organizer
 * entry (one client serves every tenant — the org is resolved from the token),
 * so this transport targets `apiBaseUrl` directly.
 *
 * @param auth - Shared AuthService used to read the OIDC access token
 * @param logger - Logger scoped to the organizer transport
 * @param config - Resolved runtime AppConfig providing `apiBaseUrl`
 * @returns A configured Connect transport with logging, auth, and auth-retry interceptors
 */
export const createOrganizerTransport = (
	auth: IAuthService,
	logger: ILogger,
	config: AppConfig,
) => {
	/** Injects the OIDC access token as a bearer token on every request. */
	const authInterceptor: Interceptor = (next) => async (req) => {
		try {
			const user = await auth.getUserManager().getUser()
			if (user?.access_token) {
				req.header.set('Authorization', `Bearer ${user.access_token}`)
			}
		} catch (err) {
			logger.error('Failed to get user from UserManager', err)
		}
		return await next(req)
	}

	/** Logs each Connect-RPC request/response with its wall-clock duration. */
	const loggingInterceptor: Interceptor = (next) => async (req) => {
		const method = `${req.service.typeName}/${req.method.name}`
		const start = performance.now()
		logger.debug('RPC request', method)
		try {
			const response = await next(req)
			const durationMs = Math.round(performance.now() - start)
			logger.debug('RPC response', method, `${durationMs}ms`)
			return response
		} catch (err) {
			const durationMs = Math.round(performance.now() - start)
			logger.error('RPC error', method, `${durationMs}ms`, err)
			throw err
		}
	}

	// Order (outer → inner): logging wraps everything; authInterceptor injects
	// the current token; the auth-retry interceptor (innermost, closest to the
	// call) catches Unauthenticated, silently refreshes, and retries with the
	// fresh token. Mirrors the admin transport's auth/retry ordering.
	return createConnectTransport({
		baseUrl: config.apiBaseUrl,
		interceptors: [
			loggingInterceptor,
			authInterceptor,
			createOrganizerAuthRetryInterceptor(auth),
		],
	})
}
