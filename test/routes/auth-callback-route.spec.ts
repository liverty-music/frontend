import type { RouteNode } from '@aurelia/router'
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
	const stub = { id: 'u1', externalId: 'ext', email: 'u@test.com', name: 'U' }
	const svc = {
		_current: stub as unknown as
			| import('../../src/entities/user').User
			| undefined,
		get current() {
			return svc._current
		},
		create: vi.fn().mockResolvedValue(stub),
		ensureLoaded: vi.fn().mockResolvedValue(stub),
	}
	return svc
}

function createMockMergeService() {
	return {
		merge: vi.fn().mockResolvedValue(undefined),
	}
}

function createMockGuestService(home: string | null = null) {
	return {
		follows: [],
		home,
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

	function setup(guestHome: string | null = null) {
		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IUserService, mockUserService as IUserService),
			Registration.instance(
				IGuestDataMergeService,
				mockMergeService as IGuestDataMergeService,
			),
			Registration.instance(IGuestService, createMockGuestService(guestHome)),
		)
		container.register(AuthCallbackRoute)
		sut = container.get(AuthCallbackRoute)
	}

	beforeEach(() => {
		mockAuth = createMockAuth({
			isAuthenticated: false,
			ready: Promise.resolve(),
		})
		mockUserService = createMockUserService()
		mockMergeService = createMockMergeService()
		setup()
	})

	describe('canLoad', () => {
		it('redirects to dashboard for returning user (cache hit → ensureLoaded resolves a user, Create not called)', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'existing@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('delegates cache-miss recovery to UserService.ensureLoaded — Create is NOT called from auth-callback when there is no guest home', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})
			// ensureLoaded internally handles cache hit/miss (calls Get or Create
			// depending on cache state). Auth-callback only invokes Create
			// explicitly when there is a guestHome to persist atomically.
			mockUserService.ensureLoaded = vi.fn().mockResolvedValue(undefined)

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('explicitly calls Create with home when guest selected one — sets postSignupShown flag', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})
			setup('JP-13')

			localStorage.removeItem('liverty:postSignup:shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.create).toHaveBeenCalled()
			expect(mockUserService.ensureLoaded).not.toHaveBeenCalled()
			expect(result).toBe('/dashboard')
			expect(localStorage.getItem('liverty:postSignup:shown')).toBe('pending')
		})

		it('does NOT set postSignupShown when guest home is absent — relies on ensureLoaded only', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'returning@example.com' },
			})
			setup(null)

			localStorage.removeItem('liverty:postSignup:shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(result).toBe('/dashboard')
			expect(localStorage.getItem('liverty:postSignup:shown')).toBeNull()
		})

		it('redirects to dashboard on error if already authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('callback error'))
			mockAuth.isAuthenticated = true

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
			expect(sut.error).toBe('')
		})

		it('shows error when callback fails and not authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('auth failed'))
			mockAuth.isAuthenticated = false

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: auth failed')
		})

		it('does not invoke explicit Create when email is missing even with guest home', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: {},
			})
			setup('JP-13')
			mockUserService.ensureLoaded = vi.fn().mockResolvedValue(undefined)

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('surfaces ensureLoaded errors as a login failure', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'new@example.com' },
			})
			mockUserService.ensureLoaded = vi
				.fn()
				.mockRejectedValue(new Error('server error'))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: server error')
		})

		it('delegates onboarding completion to merge service (not call complete directly)', async () => {
			mockAuth.handleCallback = vi.fn().mockResolvedValue({
				profile: { email: 'user@example.com' },
			})

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockMergeService.merge).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})
	})
})
