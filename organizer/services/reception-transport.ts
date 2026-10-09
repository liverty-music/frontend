import type { Interceptor, Transport } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import type { ILogger } from 'aurelia'
import type { AppConfig } from '../../shared/config/app-config'

/**
 * Creates the Connect transport the reception screen calls ReceptionService
 * through. Unlike {@link ./organizer-transport}, it carries NO bearer token and
 * no sign-in retry: reception staff have no account, and the caller is the
 * link token plus the device's signature carried in each request. Sending an
 * operator's console token from a shared browser would add nothing and widen
 * what a reception call carries.
 */
export const createReceptionTransport = (
	logger: ILogger,
	config: AppConfig,
): Transport => {
	/** Logs each call with its duration; never the request body. */
	const loggingInterceptor: Interceptor = (next) => async (req) => {
		const method = `${req.service.typeName}/${req.method.name}`
		const start = performance.now()
		try {
			const response = await next(req)
			logger.debug(
				'RPC response',
				method,
				`${Math.round(performance.now() - start)}ms`,
			)
			return response
		} catch (err) {
			logger.warn(
				'RPC error',
				method,
				`${Math.round(performance.now() - start)}ms`,
				err,
			)
			throw err
		}
	}

	return createConnectTransport({
		baseUrl: config.apiBaseUrl,
		defaultTimeoutMs: config.rpcTimeoutMs,
		interceptors: [loggingInterceptor],
	})
}
