import type { Interceptor } from '@connectrpc/connect'
import { Code, ConnectError } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { ILogger } from 'aurelia'
import type { AppConfig } from '../config/app-config'
import {
	classifyRpcOutcome,
	recordRpcCall,
} from '../lib/analytics/rpc-telemetry'
import type { IAuthService } from './auth-service'
import {
	createAuthRetryInterceptor,
	createRetryInterceptor,
} from './connect-error-router'

const tracer = trace.getTracer('connect-rpc')

/** Returns true for errors caused by intentional request cancellation. */
const isCancellation = (err: unknown): boolean =>
	(err instanceof DOMException && err.name === 'AbortError') ||
	(err instanceof ConnectError && err.code === Code.Canceled)

/**
 * Creates a Connect transport with authentication, logging, and OTEL interceptors.
 *
 * This factory function accepts IAuthService, ILogger, and AppConfig as
 * dependencies to avoid calling resolve() outside of a DI resolution context,
 * which would cause AUR0002 errors in Aurelia 2.
 *
 * @param auth - The AuthService instance to use for retrieving JWT tokens
 * @param logger - The ILogger instance scoped to transport
 * @param config - The resolved runtime AppConfig providing apiBaseUrl
 * @returns A configured Connect transport with auth, logging, and tracing interceptors
 */
export const createTransport = (
	auth: IAuthService,
	logger: ILogger,
	config: AppConfig,
) => {
	/**
	 * Interceptor to inject JWT token from OIDC UserManager.
	 */
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

	/**
	 * Interceptor that logs Connect-RPC requests and responses.
	 */
	const loggingInterceptor: Interceptor = (next) => async (req) => {
		const method = `${req.service.typeName}/${req.method.name}`
		const start = performance.now()

		logger.debug('RPC request', method)

		try {
			const response = await next(req)
			const durationMs = Math.round(performance.now() - start)
			logger.debug('RPC response', method, `${durationMs}ms`)
			// Records the full client-observed duration — this measurement point
			// wraps the whole interceptor chain, so it spans the shared deadline
			// window (auth silent-refresh + Unavailable backoff). Goes through the
			// module seam so the transport stays decoupled from the analytics graph.
			recordRpcCall(method, durationMs, 'ok')
			return response
		} catch (err) {
			const durationMs = Math.round(performance.now() - start)
			// Record every terminal call, including a cancelled/aborted one —
			// classifyRpcOutcome keeps `Canceled` distinct from `DeadlineExceeded`
			// so a user-navigation abort does not inflate the deadline-firing rate.
			recordRpcCall(method, durationMs, classifyRpcOutcome(err))
			if (!isCancellation(err)) {
				if (err instanceof ConnectError) {
					logger.error(
						'RPC error',
						method,
						`${durationMs}ms`,
						err.code.toString(),
					)
				} else {
					logger.error('RPC error', method, `${durationMs}ms`, err)
				}
			}
			throw err
		}
	}

	/**
	 * Interceptor that creates OTEL spans for Connect-RPC calls.
	 * Records rpc.system, rpc.service, rpc.method as span attributes.
	 * On failure, captures ConnectError code and records the exception.
	 */
	const otelInterceptor: Interceptor = (next) => async (req) => {
		const serviceName = req.service.typeName
		const methodName = req.method.name
		const spanName = `${serviceName}/${methodName}`

		return tracer.startActiveSpan(spanName, async (span) => {
			span.setAttributes({
				'rpc.system': 'connect',
				'rpc.service': serviceName,
				'rpc.method': methodName,
			})

			try {
				const response = await next(req)
				span.setStatus({ code: SpanStatusCode.OK })
				return response
			} catch (err) {
				if (isCancellation(err)) {
					span.setStatus({ code: SpanStatusCode.OK })
					throw err
				}
				if (err instanceof ConnectError) {
					span.setAttributes({
						'rpc.connect.error_code': err.code.toString(),
						'rpc.connect.error_message': err.message,
					})
				}
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: err instanceof Error ? err.message : String(err),
				})
				span.recordException(
					err instanceof Error ? err : new Error(String(err)),
				)
				throw err
			} finally {
				span.end()
			}
		})
	}

	return createConnectTransport({
		baseUrl: config.apiBaseUrl,
		// Single client-side deadline for every RPC (no per-method override). The
		// one deadline is shared across the interceptor chain — including the
		// auth silent-refresh retry and the transient-`Unavailable` backoff — so a
		// hung backend rejects with `Code.DeadlineExceeded` within a known window.
		defaultTimeoutMs: config.rpcTimeoutMs,
		interceptors: [
			otelInterceptor,
			loggingInterceptor,
			authInterceptor,
			createAuthRetryInterceptor(auth),
			createRetryInterceptor(),
		],
	})
}
