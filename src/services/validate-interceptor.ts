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
 * Request types the client sends unvalidated: each is built only from ids the
 * app already holds, never from what the fan typed, so a rule it breaks is an
 * app bug the backend reports anyway. They are the requests a tap on a
 * Discovery bubble sends; compiling their rules the first time one is sent
 * cost a 176-246 ms frame right after the tap at 4x CPU throttling (design of
 * `smooth-discovery-and-faster-start-up`). Named by type name, not by schema,
 * so this module does not pull the service descriptors into the boot chunk.
 */
export const UNVALIDATED_REQUEST_TYPES: ReadonlySet<string> = new Set([
	'liverty_music.rpc.artist.v1.ListSimilarRequest',
	'liverty_music.rpc.follow.v1.FollowRequest',
	'liverty_music.rpc.concert.v1.ListByArtistRequest',
])

/**
 * Creates an interceptor that validates outgoing unary requests against the
 * `buf.validate` rules declared in the proto schema, failing locally with
 * `InvalidArgument` (the violations are carried as the error's `cause`)
 * instead of sending a request the backend would reject.
 *
 * Request types in `unvalidated` are never compiled or validated.
 *
 * Validation never blocks a request. Loading starts at the first idle moment
 * after the interceptor is created, and until the validator module resolves,
 * requests pass through unvalidated. Compiling a request type's rules (its CEL expressions) costs
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
	unvalidated: ReadonlySet<string> = UNVALIDATED_REQUEST_TYPES,
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
	// The validator module (CEL and RE2 runtime) is large; fetch and evaluate
	// it when the page is idle rather than while the app starts.
	idle(() => {
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
	})

	return (next) => async (req) => {
		if (unvalidated.has(req.method.input.typeName)) return await next(req)
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
