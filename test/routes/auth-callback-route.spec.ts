import { I18N } from '@aurelia/i18n'
import type { RouteNode } from '@aurelia/router'
import { IEventAggregator, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCallbackRoute } from '../../src/routes/auth-callback/auth-callback-route'
import { IAuthService } from '../../src/services/auth-service'
import { GuestMigrationRequested } from '../../src/services/events/guest-migration-requested'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { IUserService } from '../../src/services/user-service'
import { IUserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'
import type { createMockI18n } from '../helpers/mock-i18n'

/**
 * Build the handleCallback result: the OIDC User. handleCallback no longer
 * round-trips a sign-up flag — the callback keys behavior on the backend
 * new-account signal (ProvisionResult.created), not the sign-up FLOW.
 */
function authUser(email: string | undefined): { profile: { email?: string } } {
	return { profile: email ? { email } : {} }
}

function createMockUserService() {
	const stub = { id: 'u1', externalId: 'ext', email: 'u@test.com', name: 'U' }
	// Mirrors UserServiceClient's public @observable `current` field shape.
	// Tests assign to `current` directly to simulate the post-RPC entity
	// state the production service write-throughs would produce. create /
	// ensureLoaded resolve a ProvisionResult { user, created }; per-test
	// overrides set `created` to drive the post-signup-dialog assertions.
	const svc = {
		current: stub as unknown as
			| import('../../src/entities/user').User
			| undefined,
		create: vi.fn().mockResolvedValue({ user: stub, created: true }),
		ensureLoaded: vi.fn().mockResolvedValue({ user: stub, created: false }),
	}
	return svc
}

function createMockOnboarding() {
	return {
		complete: vi.fn(),
	}
}

// UserStore now owns the guest home slice (read via `guestHome`) and the
// home/language/help-seen reset (`clearGuest`), absorbing what GuestService +
// GuestDataMergeService used to provide on this path.
function createMockUserStore(home: string | null = null) {
	return {
		guestHome: home,
		clearGuest: vi.fn(),
	}
}

describe('AuthCallbackRoute', () => {
	let sut: AuthCallbackRoute
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockUserService: ReturnType<typeof createMockUserService>
	let mockOnboarding: ReturnType<typeof createMockOnboarding>
	let mockUserStore: ReturnType<typeof createMockUserStore>
	let mockI18n: ReturnType<typeof createMockI18n>
	let mockEa: {
		publish: ReturnType<typeof vi.fn>
		subscribe: ReturnType<typeof vi.fn>
	}

	function setup(guestHome: string | null = null) {
		mockUserStore = createMockUserStore(guestHome)
		const container = createTestContainer(
			Registration.instance(IAuthService, mockAuth as IAuthService),
			Registration.instance(IUserService, mockUserService as IUserService),
			Registration.instance(
				IOnboardingService,
				mockOnboarding as unknown as IOnboardingService,
			),
			Registration.instance(IUserStore, mockUserStore as unknown as IUserStore),
			Registration.instance(
				IEventAggregator,
				mockEa as unknown as IEventAggregator,
			),
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
		mockOnboarding = createMockOnboarding()
		mockEa = { publish: vi.fn(), subscribe: vi.fn() }
		setup()
	})

	describe('canLoad', () => {
		it('redirects to dashboard for returning user (cache hit → ensureLoaded resolves a user, Create not called)', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('existing@example.com'))

			const result = await sut.canLoad({}, {} as RouteNode)

			// Assert the language argument so a regression that drops it
			// (reverting to the old zero-arg form) fails here instead of
			// silently breaking the backend Create RPC's protovalidate
			// constraint on empty preferred_language.
			expect(mockUserService.ensureLoaded).toHaveBeenCalledWith(
				expect.stringMatching(/^(en|ja)$/),
			)
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockOnboarding.complete).toHaveBeenCalled()
			expect(mockUserStore.clearGuest).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('delegates cache-miss recovery to UserService.ensureLoaded — Create is NOT called from auth-callback when there is no guest home', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com'))
			// ensureLoaded internally handles cache hit/miss (calls Get or Create
			// depending on cache state). Auth-callback only invokes Create
			// explicitly when there is a guestHome to persist atomically.
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: undefined, created: false })

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockOnboarding.complete).toHaveBeenCalled()
			expect(mockUserStore.clearGuest).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('explicitly calls Create with home when guest selected one — created=true sets postSignupShown flag', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com'))
			setup('JP-13')
			// Genuinely new account: Create minted a fresh row.
			mockUserService.create = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: true })

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

		it('a NEW no-home account still migrates and shows postSignup (migration fires regardless of home; created=true)', async () => {
			// New account where the visitor skipped home selection: guestHome is
			// null so provisioning goes through ensureLoaded (not Create), which
			// reports created=true (cache-miss Create path). The migration trigger
			// and the postSignup flag MUST still fire.
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com'))
			setup(null)
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: true })

			localStorage.removeItem('liverty:postSignup:shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			// Migration published with the provisioned user id → migration runs.
			expect(mockEa.publish).toHaveBeenCalledWith(
				new GuestMigrationRequested('u1'),
			)
			expect(localStorage.getItem('liverty:postSignup:shown')).toBe('pending')
			expect(result).toBe('/dashboard')
		})

		it('a RETURNING sign-in DOES migrate (guest follows heal in-session) but does NOT set postSignup', async () => {
			// created=false → no postSignup flag, even though ensureLoaded hydrates
			// a user. Migration STILL fires: a returning user who browsed
			// anonymously and signed in must not lose their guest follows in-session
			// (FollowStore is receipt-guarded + idempotent, so this is safe).
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('returning@example.com'))
			setup(null)
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: false })

			localStorage.removeItem('liverty:postSignup:shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			// Migration fires on sign-in too (Correction 1).
			expect(mockEa.publish).toHaveBeenCalledWith(
				new GuestMigrationRequested('u1'),
			)
			// But no new-account dialog (Correction 2).
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
			mockAuth.handleCallback = vi.fn().mockResolvedValue(authUser(undefined))
			setup('JP-13')
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: undefined, created: false })

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('surfaces ensureLoaded errors as a login failure', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com'))
			mockUserService.ensureLoaded = vi
				.fn()
				.mockRejectedValue(new Error('server error'))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.error).toBe('Login failed: server error')
		})

		it('delegates onboarding completion to merge service (not call complete directly)', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('user@example.com'))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockOnboarding.complete).toHaveBeenCalled()
			expect(mockUserStore.clearGuest).toHaveBeenCalled()
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
				mockAuth.handleCallback = vi
					.fn()
					.mockResolvedValue(authUser('returning@example.com'))
				// Default mock i18n locale is 'ja'; ensureLoaded resolves a
				// user whose stored language is 'en' — the guard
				// ('en' !== 'ja') should fire setLocale('en').
				mockUserService.ensureLoaded = vi.fn().mockImplementation(async () => {
					mockUserService.current = {
						id: 'u1',
						preferredLanguage: 'en',
					} as unknown as import('../../src/entities/user').User
					return { user: mockUserService.current, created: false }
				})

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(mockI18n.setLocale).toHaveBeenCalledWith('en')
				expect(result).toBe('/dashboard')
			})

			it('does NOT call setLocale when preferredLanguage matches the current locale', async () => {
				mockAuth.handleCallback = vi
					.fn()
					.mockResolvedValue(authUser('returning@example.com'))
				// preferredLanguage matches the mock locale 'ja' — guard
				// short-circuits and setLocale stays untouched.
				mockUserService.ensureLoaded = vi.fn().mockImplementation(async () => {
					mockUserService.current = {
						id: 'u1',
						preferredLanguage: 'ja',
					} as unknown as import('../../src/entities/user').User
					return { user: mockUserService.current, created: false }
				})

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(mockI18n.setLocale).not.toHaveBeenCalled()
				expect(result).toBe('/dashboard')
			})

			it('does NOT call setLocale when preferredLanguage is unsupported', async () => {
				mockAuth.handleCallback = vi
					.fn()
					.mockResolvedValue(authUser('returning@example.com'))
				// A future migration or loosened backend validation could
				// leak an unsupported code into the DB. We skip the
				// setLocale call (i18next would silently fall back to
				// fallbackLng with no bundle, leaving the UI blank) and log
				// a warning instead.
				mockUserService.ensureLoaded = vi.fn().mockImplementation(async () => {
					mockUserService.current = {
						id: 'u1',
						preferredLanguage: 'fr',
					} as unknown as import('../../src/entities/user').User
					return { user: mockUserService.current, created: false }
				})

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(mockI18n.setLocale).not.toHaveBeenCalled()
				expect(result).toBe('/dashboard')
			})
		})
	})
})
