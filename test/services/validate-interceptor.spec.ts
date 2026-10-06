import {
	CreateAuthorizationRequestSchema,
	LotteryService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/lottery/v1/lottery_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { createValidator, type Validator } from '@bufbuild/protovalidate'
import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it, vi } from 'vitest'
import {
	createValidateInterceptor,
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
		service: LotteryService,
		method: LotteryService.method.createAuthorization,
		header: new Headers(),
		message: create(CreateAuthorizationRequestSchema, init),
	} as any
}

const validRequest = () =>
	makeRequest({
		phaseId: { value: '0190a8c4-0000-7000-8000-000000000001' },
		requestedTicketCount: 2,
	})

// Missing phase_id and a zero count both violate the proto rules.
const invalidRequest = () => makeRequest({ requestedTicketCount: 0 })

/** Resolves the loader and lets the interceptor's `.then` run. */
async function loaded(validator: Validator = createValidator()) {
	const load: ValidatorLoader = () => Promise.resolve(validator)
	const interceptor = createValidateInterceptor(load, mockLogger)
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

	it('does not validate streaming requests', async () => {
		const validator = { validate: vi.fn() } as unknown as Validator
		const next = vi.fn().mockResolvedValue({ message: 'ok' })
		const handler = (await loaded(validator))(next)

		await handler(makeRequest({}, true))

		expect(validator.validate).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalledOnce()
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
})
