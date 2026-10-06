import type { Validator } from '@bufbuild/protovalidate'
import type { Interceptor } from '@connectrpc/connect'
import { Code, ConnectError } from '@connectrpc/connect'
import type { ILogger } from 'aurelia'

/** Resolves the protovalidate validator; called once per interceptor. */
export type ValidatorLoader = () => Promise<Validator>

let sharedValidator: Promise<Validator> | null = null

/**
 * Lazily loads `@bufbuild/protovalidate` (and its CEL / RE2 runtime) as a
 * separate chunk and memoizes one validator for every transport. The
 * validator caches compiled rules per message type, so sharing it means each
 * request type is compiled once per page load, not once per RPC client.
 */
export const loadSharedValidator: ValidatorLoader = () => {
	sharedValidator ??= import('@bufbuild/protovalidate').then(
		({ createValidator }) => createValidator(),
	)
	return sharedValidator
}

/**
 * Creates an interceptor that validates outgoing unary requests against the
 * `buf.validate` rules declared in the proto schema, failing locally with
 * `InvalidArgument` (the violations are carried as the error's `cause`)
 * instead of sending a request the backend would reject.
 *
 * Loading starts when the interceptor is created and never blocks a request:
 * until the validator module resolves, requests pass through unvalidated.
 * The backend validates every request with the same rules, so a request
 * that slips through early is still rejected authoritatively.
 */
export const createValidateInterceptor = (
	load: ValidatorLoader,
	logger: ILogger,
): Interceptor => {
	let validator: Validator | null = null
	load().then(
		(v) => {
			validator = v
		},
		(err) => {
			// Without the chunk the client simply stops pre-validating; the
			// backend remains authoritative.
			logger.warn('Failed to load request validator', err)
		},
	)

	return (next) => async (req) => {
		if (req.stream === false && validator) {
			const result = validator.validate(req.method.input, req.message)
			if (result.kind === 'invalid') {
				throw new ConnectError(
					result.error.message,
					Code.InvalidArgument,
					undefined,
					undefined,
					result.error,
				)
			}
			if (result.kind === 'error') {
				// A rule the client runtime cannot compile or evaluate is not the
				// caller's fault; let the backend decide.
				logger.warn(
					'Request validation errored; forwarding unvalidated',
					`${req.service.typeName}/${req.method.name}`,
					result.error,
				)
			}
		}
		return await next(req)
	}
}
