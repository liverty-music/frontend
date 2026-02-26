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

		const mockUserManager = {
			signinSilent: vi.fn().mockResolvedValue({ access_token: 'new-token' }),
			removeUser: vi.fn(),
		}
		mockAuth.getUserManager = vi.fn().mockReturnValue(mockUserManager)

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)
		const req = makeRequest()

		const result = await handler(req)

		expect(result).toBe(response)
		expect(mockUserManager.signinSilent).toHaveBeenCalled()
		expect(req.header.get('Authorization')).toBe('Bearer new-token')
		expect(next).toHaveBeenCalledTimes(2)
	})

	it('should propagate Unauthenticated error for guest users without refresh', async () => {
		const error = new ConnectError('unauthenticated', Code.Unauthenticated)
		const next = vi.fn().mockRejectedValue(error)

		// auth.user is null (guest/tutorial mode)
		mockAuth.user = null

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(mockAuth.getUserManager).not.toHaveBeenCalled()
	})

	it('should remove user and rethrow when token refresh fails', async () => {
		const next = vi
			.fn()
			.mockRejectedValue(
				new ConnectError('unauthenticated', Code.Unauthenticated),
			)

		// auth.user must be truthy to attempt silent refresh
		mockAuth.user = { access_token: 'old-token' } as any

		const mockUserManager = {
			signinSilent: vi.fn().mockRejectedValue(new Error('refresh failed')),
			removeUser: vi.fn().mockResolvedValue(undefined),
		}
		mockAuth.getUserManager = vi.fn().mockReturnValue(mockUserManager)

		const interceptor = createAuthRetryInterceptor(mockAuth as any)
		const handler = interceptor(next)

		await expect(handler(makeRequest())).rejects.toThrow()
		expect(mockUserManager.removeUser).toHaveBeenCalled()
		// window.location.href is set to '/welcome' but jsdom assignment is not easily spied
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

	it('should retry on DeadlineExceeded error', async () => {
		const response = { message: 'ok' }
		const next = vi
			.fn()
			.mockRejectedValueOnce(
				new ConnectError('deadline', Code.DeadlineExceeded),
			)
			.mockResolvedValue(response)

		const interceptor = createRetryInterceptor(3)
		const handler = interceptor(next)

		const promise = handler(makeRequest())
		await vi.advanceTimersByTimeAsync(200)

		const result = await promise
		expect(result).toBe(response)
		expect(next).toHaveBeenCalledTimes(2)
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
