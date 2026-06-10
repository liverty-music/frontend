import type { Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import type { ILogger } from 'aurelia'
import type { AppConfig } from '../../shared/config/app-config'
import type { IAuthService } from '../../shared/services/auth-service'

/**
 * Creates a Connect transport for the admin console with authentication and
 * logging interceptors.
 *
 * Deliberately admin-local and minimal: it must NOT import the consumer's
 * `src/services/grpc-transport.ts` (bundle-isolation / import-boundary rule —
 * admin code may only cross into `shared/`). It therefore drops the consumer's
 * OTEL and retry interceptors, keeping just the two an admin reviewer needs:
 * bearer-token injection and request/response logging.
 *
 * Accepts `IAuthService`, `ILogger`, and `AppConfig` as parameters rather than
 * calling `resolve()` internally so it can run outside a DI resolution context
 * without triggering AUR0002 (mirrors the consumer transport's documented
 * factory shape).
 *
 * Targets the dedicated admin API host (`adminApiBaseUrl`, i.e. `api.admin.{env}`)
 * served by the backend's separate admin Connect server. Falls back to
 * `apiBaseUrl` when `adminApiBaseUrl` is absent so the console keeps working
 * before the cutover sets the admin host.
 *
 * @param auth - Shared AuthService used to read the OIDC access token
 * @param logger - Logger scoped to the admin transport
 * @param config - Resolved runtime AppConfig providing `adminApiBaseUrl` (falls back to `apiBaseUrl`)
 * @returns A configured Connect transport with auth + logging interceptors
 */
export const createAdminTransport = (
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

	return createConnectTransport({
		baseUrl: config.adminApiBaseUrl ?? config.apiBaseUrl,
		interceptors: [loggingInterceptor, authInterceptor],
	})
}
