import { create, type DescMessage } from '@bufbuild/protobuf'
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

/** Runs a callback when the main thread is idle. */
export type IdleScheduler = (callback: () => void) => void

/**
 * Upper bound before a scheduled compilation runs even if the page never goes
 * idle. Without one, `requestIdleCallback` may never fire on a page that keeps
 * the main thread busy (Discovery's animation loop), leaving the type
 * unvalidated for the session. Long enough to stay clear of a cold load's
 * first reveal (seconds on a slow phone); a compilation that has to wait this
 * long costs one long frame once per request type.
 */
const IDLE_COMPILE_TIMEOUT_MS = 10_000

const scheduleIdle: IdleScheduler = (callback) => {
	if (typeof requestIdleCallback === 'function') {
		requestIdleCallback(() => callback(), { timeout: IDLE_COMPILE_TIMEOUT_MS })
	} else {
		setTimeout(callback, 0)
	}
}

/**
 * Creates an interceptor that validates outgoing unary requests against the
 * `buf.validate` rules declared in the proto schema, failing locally with
 * `InvalidArgument` (the violations are carried as the error's `cause`)
 * instead of sending a request the backend would reject.
 *
 * Validation never blocks a request. Loading starts when the interceptor is
 * created, and until the validator module resolves, requests pass through
 * unvalidated. Compiling a request type's rules (its CEL expressions) costs
 * seconds of main-thread time on a slow phone, so it does not run on the
 * request's path either: the first request of a type passes through and
 * schedules the compilation for an idle moment (at the latest
 * `IDLE_COMPILE_TIMEOUT_MS` later); requests of that type sent before it
 * runs pass through too, and later ones are validated. The backend validates every request with the same rules, so
 * a request that slips through early is still rejected authoritatively.
 */
export const createValidateInterceptor = (
	load: ValidatorLoader,
	logger: ILogger,
	idle: IdleScheduler = scheduleIdle,
): Interceptor => {
	let validator: Validator | null = null
	// Request types whose rules are compiled, and those scheduled to compile.
	const compiled = new Set<string>()
	const scheduled = new Set<string>()
	const compileWhenIdle = (v: Validator, type: DescMessage): void => {
		if (scheduled.has(type.typeName)) return
		scheduled.add(type.typeName)
		idle(() => {
			// Validating a default message compiles and caches the type's rules.
			v.validate(type, create(type))
			compiled.add(type.typeName)
		})
	}
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
			compileWhenIdle(validator, req.method.input)
		}
		if (
			req.stream === false &&
			validator &&
			compiled.has(req.method.input.typeName)
		) {
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
