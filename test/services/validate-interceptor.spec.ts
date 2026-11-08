import { ListSimilarRequestSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/artist/v1/artist_service_pb.js'
import { ListByArtistRequestSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { FollowRequestSchema } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/follow/v1/follow_service_pb.js'
import {
	CreateRequestSchema,
	IdentityVerificationService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/identity_verification/v1/identity_verification_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { createValidator, type Validator } from '@bufbuild/protovalidate'
import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it, vi } from 'vitest'
import {
	createValidateInterceptor,
	UNVALIDATED_REQUEST_TYPES,
	type ValidatorLoader,
} from '../../src/services/validate-interceptor'

const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as any

function makeRequest(init: Record<string, unknown>, stream = false) {
	return {
		stream,
		service: IdentityVerificationService,
		method: IdentityVerificationService.method.create,
		header: new Headers(),
		message: create(CreateRequestSchema, init),
	} as any
}

const validRequest = () => makeRequest({ sessionId: 'sess-1' })

// An empty session_id violates its min_len rule.
const invalidRequest = () => makeRequest({ sessionId: '' })

/** Resolves the loader and lets the interceptor's `.then` run. */
async function loaded(
	validator: Validator = createValidator(),
	idle: (callback: () => void) => void = (callback) => callback(),
) {
	const load: ValidatorLoader = () => Promise.resolve(validator)
	const interceptor = createValidateInterceptor(load, mockLogger, idle)
	await Promise.resolve()
	await Promise.resolve()
	return interceptor
}

describe('createValidateInterceptor', () => {
	it('rejects an invalid request with InvalidArgument without calling next', async () => {
		const next = vi.fn()
		const handler = (await loaded())(next)

		const err = await handler(invalidRequest()).catch((e: unknown) => e)

		expect(err).toBeInstanceOf(ConnectError)
		expect((err as ConnectError).code).toBe(Code.InvalidArgument)
		const cause = (err as ConnectError).cause as { violations: unknown[] }
		expect(cause.violations.length).toBeGreaterThan(0)
		expect(next).not.toHaveBeenCalled()
	})

	it('forwards a valid request', async () => {
		const response = { message: 'ok' }
		const next = vi.fn().mockResolvedValue(response)
		const handler = (await loaded())(next)
		const req = validRequest()

		await expect(handler(req)).resolves.toBe(response)
		expect(next).toHaveBeenCalledWith(req)
	})

	it('forwards requests unvalidated before the validator has loaded', async () => {
		const load: ValidatorLoader = () => new Promise(() => {})
		const next = vi.fn().mockResolvedValue({ message: 'ok' })
		const handler = createValidateInterceptor(load, mockLogger)(next)
		const req = invalidRequest()

		await handler(req)

		expect(next).toHaveBeenCalledWith(req)
	})

	it('forwards requests unvalidated when the validator fails to load', async () => {
		const load: ValidatorLoader = () => Promise.reject(new Error('chunk 404'))
		const interceptor = createValidateInterceptor(load, mockLogger)
		await Promise.resolve()
		await Promise.resolve()
		const next = vi.fn().mockResolvedValue({ message: 'ok' })

		await interceptor(next)(invalidRequest())

		expect(next).toHaveBeenCalledOnce()
	})

	it('loads the validator module only when the page is idle', async () => {
		const load = vi.fn(() => Promise.resolve(createValidator()))
		const idleCallbacks: (() => void)[] = []
		createValidateInterceptor(load, mockLogger, (cb) => idleCallbacks.push(cb))

		expect(load).not.toHaveBeenCalled()
		idleCallbacks[0]()
		expect(load).toHaveBeenCalledOnce()
	})

	it('does not validate streaming requests', async () => {
		const validator = { validate: vi.fn() } as unknown as Validator
		const next = vi.fn().mockResolvedValue({ message: 'ok' })
		const handler = (await loaded(validator))(next)

		await handler(makeRequest({}, true))

		expect(validator.validate).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalledOnce()
	})

	it('passes the first request of a type through and validates once its rules compiled when idle', async () => {
		const idleCallbacks: (() => void)[] = []
		const validator = createValidator()
		const validate = vi.spyOn(validator, 'validate')
		const next = vi.fn().mockResolvedValue({ message: 'ok' })
		const handler = (await loaded(validator, (cb) => idleCallbacks.push(cb)))(
			next,
		)
		// The first idle callback loads the validator module.
		idleCallbacks.shift()?.()
		await Promise.resolve()
		await Promise.resolve()

		// Not compiled yet: forwarded unvalidated, compilation only scheduled.
		await handler(invalidRequest())
		expect(next).toHaveBeenCalledOnce()
		expect(validate).not.toHaveBeenCalled()
		await handler(invalidRequest())
		expect(idleCallbacks).toHaveLength(1)

		idleCallbacks[0]()
		const err = await handler(invalidRequest()).catch((e: unknown) => e)

		expect((err as ConnectError).code).toBe(Code.InvalidArgument)
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('forwards the request when the validator reports a rule error', async () => {
		const validator = {
			validate: vi.fn().mockReturnValue({
				kind: 'error',
				error: new Error('compilation failed'),
			}),
		} as unknown as Validator
		const next = vi.fn().mockResolvedValue({ message: 'ok' })
		const handler = (await loaded(validator))(next)

		await handler(validRequest())

		expect(next).toHaveBeenCalledOnce()
	})

	describe('request types sent unvalidated', () => {
		it('never compiles or validates a type in the unvalidated set', async () => {
			const scheduled: (() => void)[] = []
			const idle = (callback: () => void) => {
				scheduled.push(callback)
			}
			const load: ValidatorLoader = () => Promise.resolve(createValidator())
			const interceptor = createValidateInterceptor(
				load,
				mockLogger,
				idle,
				new Set([CreateRequestSchema.typeName]),
			)
			// Only the validator module's load is scheduled.
			scheduled.shift()?.()
			await Promise.resolve()
			await Promise.resolve()
			const next = vi.fn().mockResolvedValue({ message: 'ok' })
			const handler = interceptor(next)

			await handler(invalidRequest())
			for (const run of scheduled.splice(0)) run()
			await handler(invalidRequest())

			expect(scheduled).toHaveLength(0)
			expect(next).toHaveBeenCalledTimes(2)
		})

		it('names the requests a Discovery bubble tap sends, by their generated type names', () => {
			expect([...UNVALIDATED_REQUEST_TYPES].sort()).toEqual(
				[
					ListSimilarRequestSchema.typeName,
					FollowRequestSchema.typeName,
					ListByArtistRequestSchema.typeName,
				].sort(),
			)
		})
	})
})
