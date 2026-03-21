import type { RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallbackRoute } from '../../src/routes/auth-callback/auth-callback-route'
import { IAuthService } from '../../src/services/auth-service'
import { IGuestDataMergeService } from '../../src/services/guest-data-merge-service'
import { IGuestService } from '../../src/services/guest-service'
import { IUserService } from '../../src/services/user-service'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

function createMockUserService() {
	return {
		create: vi.fn().mockResolvedValue(undefined),
		ensureLoaded: vi.fn().mockResolvedValue(undefined),
	}
}

function createMockMergeService() {
	return {
		merge: vi.fn().mockResolvedValue(undefined),
	}
}

function createMockGuestService() {
	return {
		follows: [],
		home: null,
		followedCount: 0,
		follow: vi.fn(),
		unfollow: vi.fn(),
		setHome: vi.fn(),
		clearAll: vi.fn(),
		listFollowed: vi.fn().mockReturnValue([]),
	}
}

describe('AuthCallbackRoute', () => {
	let sut: AuthCallbackRoute
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockUserService: ReturnType<typeof createMockUserService>
	let mockMergeService: ReturnType<typeof createMockMergeService>

	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: false,
			ready: Promise.resolve(),
		})
		mockUserService = createMockUserService()
		mockMergeService = createMockMergeService()

		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IUserService, mockUserService as IUserService),
			Registration.instance(
				IGuestDataMergeService,
				mockMergeService as IGuestDataMergeService,
			),
			Registration.instance(IGuestService, createMockGuestService()),
		)
		container.register(AuthCallbackRoute)
		sut = container.get(AuthCallbackRoute)
	})

	describe('canLoad', () => {
		it('should redirect to dashboard for returning user (ensureLoaded succeeds, no create)', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('should provision new user when ensureLoaded returns NotFound', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})
			mockUserService.ensureLoaded = vi
				.fn()
				.mockRejectedValueOnce(new ConnectError('not found', Code.NotFound))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
			expect(mockUserService.create).toHaveBeenCalled()
			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('should redirect to dashboard on error if already authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('callback error'))
			mockAuth.isAuthenticated = true

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
			expect(sut.error).toBe('')
		})

		it('should show error when callback fails and not authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('auth failed'))
			mockAuth.isAuthenticated = false

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: auth failed')
		})

		it('should handle provisionUser ALREADY_EXISTS gracefully', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})
			mockUserService.ensureLoaded = vi
				.fn()
				.mockRejectedValueOnce(new ConnectError('not found', Code.NotFound))
			mockUserService.create = vi
				.fn()
				.mockRejectedValue(new ConnectError('exists', Code.AlreadyExists))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
		})

		it('should show error when provisionUser fails with non-AlreadyExists error', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})
			mockUserService.ensureLoaded = vi
				.fn()
				.mockRejectedValue(new ConnectError('not found', Code.NotFound))
			mockUserService.create = vi
				.fn()
				.mockRejectedValue(new Error('server error'))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: server error')
		})

		it('should skip provisionUser when email is missing and ensureLoaded returns NotFound', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: {},
			})
			mockUserService.ensureLoaded = vi
				.fn()
				.mockRejectedValueOnce(new ConnectError('not found', Code.NotFound))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('should delegate onboarding completion to merge service (not call complete directly)', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'user@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})
	})
})
