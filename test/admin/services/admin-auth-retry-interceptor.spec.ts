import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminAuthRetryInterceptor } from '../../../admin/services/admin-auth-retry-interceptor'
import { createMockAuth } from '../../helpers/mock-auth'

function makeRequest() {
	return {
		header: new Headers(),
		service: { typeName: 'AdminService' },
		method: { name: 'List' },
	} as any
}

describe('createAdminAuthRetryInterceptor', () => {
	let mockAuth: ReturnType<typeof createMockAuth>

	beforeEach(() => {
		mockAuth = createMockAuth()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('passes through successful requests without touching auth', async () => {
		const response = { message: 'ok' }
		const next = vi.fn().mockResolvedValue(response)
		const handler = createAdminAuthRetryInterceptor(mockAuth as any)(next)

		const result = await handler(makeRequest())

		expect(result).toBe(response)
		expect(next).toHaveBeenCalledTimes(1)
		expect(mockAuth.getUserManager).not.toHaveBeenCalled()
	})

	it('silently refreshes and retries with the fresh token on Unauthenticated', async () => {
		const response = { message: 'ok' }
		const next = vi
			.fn()
			.mockRejectedValueOnce(
				new ConnectError('exp not satisfied', Code.Unauthenticated),
			)
			.mockResolvedValue(response)

		const mockUserManager = {
			signinSilent: vi.fn().mockResolvedValue({ access_token: 'fresh-token' }),
			removeUser: vi.fn(),
		}
		mockAuth.getUserManager = vi.fn().mockReturnValue(mockUserManager)

		const handler = createAdminAuthRetryInterceptor(mockAuth as any)(next)
		const req = makeRequest()

		const result = await handler(req)

		expect(result).toBe(response)
		expect(mockUserManager.signinSilent).toHaveBeenCalledTimes(1)
		expect(req.header.get('Authorization')).toBe('Bearer fresh-token')
		expect(next).toHaveBeenCalledTimes(2)
		expect(mockAuth.signIn).not.toHaveBeenCalled()
	})

	it('restarts sign-in and rethrows when the silent refresh fails', async () => {
		const error = new ConnectError('exp not satisfied', Code.Unauthenticated)
		const next = vi.fn().mockRejectedValue(error)

		const mockUserManager = {
			signinSilent: vi.fn().mockRejectedValue(new Error('refresh expired')),
			removeUser: vi.fn().mockResolvedValue(undefined),
		}
		mockAuth.getUserManager = vi.fn().mockReturnValue(mockUserManager)

		const handler = createAdminAuthRetryInterceptor(mockAuth as any)(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(mockUserManager.removeUser).toHaveBeenCalledTimes(1)
		expect(mockAuth.signIn).toHaveBeenCalledTimes(1)
		// Only the original attempt; no retry since the refresh yielded no token.
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('propagates non-Unauthenticated errors unchanged', async () => {
		const error = new ConnectError('boom', Code.Internal)
		const next = vi.fn().mockRejectedValue(error)
		const handler = createAdminAuthRetryInterceptor(mockAuth as any)(next)

		await expect(handler(makeRequest())).rejects.toThrow(error)
		expect(mockAuth.getUserManager).not.toHaveBeenCalled()
		expect(next).toHaveBeenCalledTimes(1)
	})
})
