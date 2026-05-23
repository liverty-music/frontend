import { I18N } from '@aurelia/i18n'
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
import type { createMockI18n } from '../helpers/mock-i18n'

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
	let mockI18n: ReturnType<typeof createMockI18n>

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
		// createTestContainer pre-registers the mock I18N; resolve the
		// same instance the route will use so test-side spies on setLocale
		// observe what production code sees.
		mockI18n = container.get(I18N) as ReturnType<typeof createMockI18n>
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

			// Assert the language argument so a regression that drops it
			// (reverting to the old zero-arg form) fails here instead of
			// silently breaking the backend Create RPC's protovalidate
			// constraint on empty preferred_language.
			expect(mockUserService.ensureLoaded).toHaveBeenCalledWith(
				expect.stringMatching(/^(en|ja)$/),
			)
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

			// Assert email + locale + home are forwarded. Passing the
			// locale at signup time is what makes the new user row carry
			// the visitor's anonymous-period language — without the arg
			// the backend would receive an empty preferred_language and
			// protovalidate would reject the Create.
			expect(mockUserService.create).toHaveBeenCalledWith(
				'new@example.com',
				expect.stringMatching(/^(en|ja)$/),
				expect.objectContaining({ countryCode: 'JP', level1: 'JP-13' }),
			)
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

		// Coverage for the mid-session sign-in setLocale block. This is the
		// only code path that applies the backend `preferred_language` to
		// i18n for a session that started anonymous and then signed in —
		// UserHydrationTask (AppTask.activating) ran once at boot when the
		// user was still unauthenticated and won't re-fire on this redirect.
		// Without these tests, a regression that removes or mis-conditions
		// this block leaves users browsing in their pre-auth detected locale
		// until a hard reload, with no signal from the test suite.
		describe('applies backend preferredLanguage to i18n after sign-in', () => {
			it('calls setLocale when preferredLanguage differs from current locale', async () => {
				mockAuth.handleCallback = vi.fn().mockResolvedValue({
					profile: { email: 'returning@example.com' },
				})
				// Default mock i18n locale is 'ja'; ensureLoaded resolves a
				// user whose stored language is 'en' — the guard
				// ('en' !== 'ja') should fire setLocale('en').
				mockUserService.ensureLoaded = vi.fn().mockImplementation(async () => {
					mockUserService._current = {
						id: 'u1',
						preferredLanguage: 'en',
					} as unknown as import('../../src/entities/user').User
					return mockUserService._current
				})

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(mockI18n.setLocale).toHaveBeenCalledWith('en')
				expect(result).toBe('/dashboard')
			})

			it('does NOT call setLocale when preferredLanguage matches the current locale', async () => {
				mockAuth.handleCallback = vi.fn().mockResolvedValue({
					profile: { email: 'returning@example.com' },
				})
				// preferredLanguage matches the mock locale 'ja' — guard
				// short-circuits and setLocale stays untouched.
				mockUserService.ensureLoaded = vi.fn().mockImplementation(async () => {
					mockUserService._current = {
						id: 'u1',
						preferredLanguage: 'ja',
					} as unknown as import('../../src/entities/user').User
					return mockUserService._current
				})

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(mockI18n.setLocale).not.toHaveBeenCalled()
				expect(result).toBe('/dashboard')
			})

			it('does NOT call setLocale when preferredLanguage is unsupported', async () => {
				mockAuth.handleCallback = vi.fn().mockResolvedValue({
					profile: { email: 'returning@example.com' },
				})
				// A future migration or loosened backend validation could
				// leak an unsupported code into the DB. We skip the
				// setLocale call (i18next would silently fall back to
				// fallbackLng with no bundle, leaving the UI blank) and log
				// a warning instead.
				mockUserService.ensureLoaded = vi.fn().mockImplementation(async () => {
					mockUserService._current = {
						id: 'u1',
						preferredLanguage: 'fr',
					} as unknown as import('../../src/entities/user').User
					return mockUserService._current
				})

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(mockI18n.setLocale).not.toHaveBeenCalled()
				expect(result).toBe('/dashboard')
			})
		})
	})
})
