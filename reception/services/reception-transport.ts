import type { Interceptor, Transport } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import type { ILogger } from 'aurelia'
import type { ReceptionConfig } from '../config/reception-config'

/**
 * Default client-side deadline for every reception call, the same 10 s the
 * console transports default to, so a hung API fails within a known window.
 */
export const RECEPTION_RPC_TIMEOUT_MS = 10_000

/**
 * Creates the Connect transport the reception screen calls ReceptionService
 * through, on the reception API host. It carries NO bearer token and no
 * sign-in retry: reception staff have no account, and the caller is the link
 * token plus the device's signature carried in each request. The reception
 * app has no sign-in code at all, so no console token can reach a call.
 */
export const createReceptionTransport = (
	logger: ILogger,
	config: ReceptionConfig,
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
		defaultTimeoutMs: RECEPTION_RPC_TIMEOUT_MS,
		interceptors: [loggingInterceptor],
	})
}
