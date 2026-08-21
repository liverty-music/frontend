import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	createAuthRetryInterceptor,
	createRetryInterceptor,
} from '../../src/services/connect-error-router'
import { createMockAuth } from '../helpers/mock-auth'

function makeRequest() {
	return {
		header: new Headers(),
		service: { typeName: 'TestService' },
		method: { name: 'TestMethod' },
	} as any
}

describe('createAuthRetryInterceptor', () => {
	let mockAuth: ReturnType<typeof createMockAuth>

	beforeEach(() => {
		mockAuth = createMockAuth()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should pass through successful requests', async () => {
		const response = { message: 'ok' }
		const next = vi.fn().mockResolvedValue(response)
		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		const result = await handler(makeRequest())

		expect(result).toBe(response)
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('should retry with fresh token on Unauthenticated error', async () => {
		const response = { message: 'ok' }
		const next = vi
			.fn()
			.mockRejectedValueOnce(
				new ConnectError('unauthenticated', Code.Unauthenticated),
			)
			.mockResolvedValue(response)

		// auth.user must be truthy to attempt silent refresh
		mockAuth.user = { access_token: 'old-token' } as any
		mockAuth.ensureFreshToken = vi
			.fn()
			.mockResolvedValue({ access_token: 'new-token' })

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)
		const req = makeRequest()

		const result = await handler(req)

		expect(result).toBe(response)
		expect(mockAuth.ensureFreshToken).toHaveBeenCalledTimes(1)
		expect(req.header.get('Authorization')).toBe('Bearer new-token')
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('should NOT retry a second time if the retried request also 401s', async () => {
		const next = vi
			.fn()
			.mockRejectedValue(
				new ConnectError('unauthenticated', Code.Unauthenticated),
			)

		mockAuth.user = { access_token: 'old-token' } as any
		mockAuth.ensureFreshToken = vi
			.fn()
			.mockResolvedValue({ access_token: 'new-token' })

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow()
		// Bounded to once: initial + exactly one retry, no loop.
		expect(next).toHaveBeenCalledTimes(2)
		expect(mockAuth.ensureFreshToken).toHaveBeenCalledTimes(1)
		// Retried-still-401 is treated as unrecoverable → forced re-auth cleanup.
		expect(mockAuth.prepareForcedReauth).toHaveBeenCalledTimes(1)
	})

	it('should propagate Unauthenticated error for guest users without refresh', async () => {
		const error = new ConnectError('unauthenticated', Code.Unauthenticated)
		const next = vi.fn().mockRejectedValue(error)

		// auth.user is null (guest/onboarding mode)
		mockAuth.user = null

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(mockAuth.getUserManager).not.toHaveBeenCalled()
	})

	it('should force graceful re-auth and rethrow when token refresh fails', async () => {
		const next = vi
			.fn()
			.mockRejectedValue(
				new ConnectError('unauthenticated', Code.Unauthenticated),
			)

		// auth.user must be truthy to attempt silent refresh
		mockAuth.user = { access_token: 'old-token' } as any
		// Refresh fails (refresh token expired/invalid) → null
		mockAuth.ensureFreshToken = vi.fn().mockResolvedValue(null)

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow()
		// Graceful forced logout: publishes SignedOut + preserves return-to.
		expect(mockAuth.prepareForcedReauth).toHaveBeenCalledTimes(1)
		// No second retry when refresh fails.
		expect(next).toHaveBeenCalledTimes(1)
		// window.location.href is set to '/welcome' (jsdom assignment not spied)
	})

	it('should re-throw non-Unauthenticated ConnectErrors', async () => {
		const error = new ConnectError('not found', Code.NotFound)
		const next = vi.fn().mockRejectedValue(error)

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(mockAuth.getUserManager).not.toHaveBeenCalled()
	})

	it('should re-throw non-ConnectError errors', async () => {
		const error = new TypeError('network failure')
		const next = vi.fn().mockRejectedValue(error)

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
	})

	// Note: the single-flight dedup guarantee moved into AuthService
	// (`ensureFreshToken`), which the interceptor delegates to. Concurrency is
	// covered by the AuthService single-flight test, not here.
})

describe('createRetryInterceptor', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('should pass through successful requests', async () => {
		const response = { message: 'ok' }
		const next = vi.fn().mockResolvedValue(response)
		const interceptor = createRetryInterceptor(3)
		const handler = interceptor(next)

		const result = await handler(makeRequest())

		expect(result).toBe(response)
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('should retry on Unavailable error with backoff', async () => {
		const response = { message: 'ok' }
		const next = vi
			.fn()
			.mockRejectedValueOnce(new ConnectError('unavailable', Code.Unavailable))
			.mockResolvedValue(response)

		const interceptor = createRetryInterceptor(3)
		const handler = interceptor(next)

		const promise = handler(makeRequest())
		await vi.advanceTimersByTimeAsync(200) // first backoff: 200ms

		const result = await promise
		expect(result).toBe(response)
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('should NOT retry on DeadlineExceeded error', async () => {
		const next = vi
			.fn()
			.mockRejectedValueOnce(
				new ConnectError('deadline', Code.DeadlineExceeded),
			)

		const interceptor = createRetryInterceptor(3)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(ConnectError)
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('should throw after max retries exhausted', async () => {
		const error = new ConnectError('unavailable', Code.Unavailable)
		const next = vi.fn().mockRejectedValue(error)

		const interceptor = createRetryInterceptor(2)
		const handler = interceptor(next)

		const promise = handler(makeRequest()).catch((err) => err)
		// Advance past all backoff delays: 200ms + 400ms
		await vi.advanceTimersByTimeAsync(700)

		const result = await promise
		expect(result).toBeInstanceOf(ConnectError)
		expect(next).toHaveBeenCalledTimes(3) // initial + 2 retries
	})

	it('should not retry non-retryable errors', async () => {
		const error = new ConnectError('not found', Code.NotFound)
		const next = vi.fn().mockRejectedValue(error)

		const interceptor = createRetryInterceptor(3)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('should not retry non-ConnectError errors', async () => {
		const error = new TypeError('network error')
		const next = vi.fn().mockRejectedValue(error)

		const interceptor = createRetryInterceptor(3)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(next).toHaveBeenCalledTimes(1)
	})
})
