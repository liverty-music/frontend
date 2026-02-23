import type { Interceptor } from '@connectrpc/connect'
import { ConnectError } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { ILogger } from 'aurelia'
import type { IAuthService } from './auth-service'
import {
	createAuthRetryInterceptor,
	createRetryInterceptor,
} from './connect-error-router'

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

const tracer = trace.getTracer('connect-rpc')

/**
 * Creates a Connect transport with authentication, logging, and OTEL interceptors.
 *
 * This factory function accepts IAuthService and ILogger as dependencies to avoid
 * calling resolve() outside of a DI resolution context, which would
 * cause AUR0002 errors in Aurelia 2.
 *
 * @param auth - The AuthService instance to use for retrieving JWT tokens
 * @param logger - The ILogger instance scoped to transport
 * @returns A configured Connect transport with auth, logging, and tracing interceptors
 */
export const createTransport = (auth: IAuthService, logger: ILogger) => {
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
			return response
		} catch (err) {
			const durationMs = Math.round(performance.now() - start)
			if (err instanceof ConnectError) {
				logger.error('RPC error', method, `${durationMs}ms`, err.code.toString())
			} else {
				logger.error('RPC error', method, `${durationMs}ms`, err)
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
		baseUrl,
		interceptors: [
			otelInterceptor,
			loggingInterceptor,
			authInterceptor,
			createAuthRetryInterceptor(auth),
			createRetryInterceptor(),
		],
	})
}
