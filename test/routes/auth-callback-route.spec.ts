import { I18N, I18nConfiguration } from '@aurelia/i18n'
import type { RouteNode } from '@aurelia/router'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import {
	CustomElement,
	type IContainer,
	IEventAggregator,
	Registration,
} from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ILocalStorage } from '../../src/adapter/storage/local-storage'
import { IAppConfig } from '../../src/config/app-config'
import { StorageKeys } from '../../src/constants/storage-keys'
import { IAnalyticsService } from '../../src/lib/analytics/analytics-service'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'
import { AuthCallbackRoute } from '../../src/routes/auth-callback/auth-callback-route'
import { IAuthService } from '../../src/services/auth-service'
import { GuestMigrationRequested } from '../../src/services/events/guest-migration-requested'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { IUserStore } from '../../src/services/user-store'
import { createTestContainer } from '../helpers/create-container'
import { createMockAppConfig } from '../helpers/mock-app-config'
import { createMockAuth } from '../helpers/mock-auth'
import type { createMockI18n } from '../helpers/mock-i18n'

/**
 * Build the handleCallback result: the OIDC User. `flow` mirrors the OIDC
 * application `state` that `signUp()` round-trips ({ flow: 'signup' }); omit it
 * to simulate a sign-in or an older in-flight redirect that carries no marker.
 * The callback gates the post-signup dialog on this marker AND `created`.
 */
function authUser(
	email: string | undefined,
	flow?: 'signup',
): { profile: { email?: string }; state?: { flow: 'signup' } } {
	return {
		profile: email ? { email } : {},
		...(flow ? { state: { flow } } : {}),
	}
}

function createMockOnboarding() {
	return {
		finish: vi.fn(),
	}
}

// UserStore is now the single owner of the User entity AND the guest slice on
// this path: the auth bootstrap (`current` / `create` / `ensureLoaded`,
// absorbed from the former UserService) plus the guest home read (`guestHome`)
// and the home/language/help-seen reset (`clearGuest`). Tests assign to
// `current` directly to simulate the post-RPC entity state the production
// store's write-throughs would produce. create / ensureLoaded resolve a
// ProvisionResult { user, created }; per-test overrides set `created` to drive
// the post-signup-dialog assertions.
function createMockUserStore(home: string | null = null) {
	const stub = { id: 'u1', email: 'u@test.com', name: 'U' }
	return {
		current: stub as unknown as
			| import('../../src/entities/user').User
			| undefined,
		guestHome: home,
		clearGuest: vi.fn(),
		create: vi.fn().mockResolvedValue({ user: stub, created: true }),
		ensureLoaded: vi.fn().mockResolvedValue({ user: stub, created: false }),
	}
}

describe('AuthCallbackRoute', () => {
	let sut: AuthCallbackRoute
	let mockAuth: ReturnType<typeof createMockAuth>
	// UserStore is the single owner of both the User entity bootstrap and the
	// guest slice on this path. `mockUserService` is kept as an alias to the
	// same merged store object so the existing entity-bootstrap assertions read
	// naturally (create / ensureLoaded / current) while still resolving the one
	// IUserStore the route now injects.
	let mockUserStore: ReturnType<typeof createMockUserStore>
	let mockUserService: ReturnType<typeof createMockUserStore>
	let mockOnboarding: ReturnType<typeof createMockOnboarding>
	let mockI18n: ReturnType<typeof createMockI18n>
	let mockEa: {
		publish: ReturnType<typeof vi.fn>
		subscribe: ReturnType<typeof vi.fn>
	}
	/** The ILocalStorage the route writes to; fresh for every setup(). */
	let storage: ILocalStorage

	function createMemoryStorage(): ILocalStorage {
		const map = new Map<string, string>()
		return {
			getItem: (k) => map.get(k) ?? null,
			setItem: (k, v) => {
				map.set(k, v)
			},
			removeItem: (k) => {
				map.delete(k)
			},
			removeByPrefix: (prefix) => {
				for (const k of [...map.keys()]) if (k.startsWith(prefix)) map.delete(k)
			},
		}
	}

	let container: IContainer

	function setup(guestHome: string | null = null) {
		mockUserStore = createMockUserStore(guestHome)
		mockUserService = mockUserStore
		storage = createMemoryStorage()
		container = createTestContainer(
			Registration.instance(ILocalStorage, storage),
			Registration.instance(IAuthService, mockAuth as IAuthService),
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
		mockOnboarding = createMockOnboarding()
		mockEa = { publish: vi.fn(), subscribe: vi.fn() }
		setup()
	})

	describe('canLoad', () => {
		// @spec stories/complete-onboarding "Completion latches on sign-in or sign-up"
		it('redirects to dashboard for returning user (ensureLoaded resolves the existing User, Create not called)', async () => {
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
			expect(mockOnboarding.finish).toHaveBeenCalled()
			expect(mockUserStore.clearGuest).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('delegates Get-or-Create to UserStore.ensureLoaded — Create is NOT called from auth-callback when there is no guest home', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com'))
			// ensureLoaded internally calls Get, then Create when Get answers
			// NotFound. Auth-callback only invokes Create explicitly when there is
			// a guestHome to persist atomically.
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: undefined, created: false })

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalledTimes(1)
			expect(mockUserService.create).not.toHaveBeenCalled()
			expect(mockOnboarding.finish).toHaveBeenCalled()
			expect(mockUserStore.clearGuest).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
		})

		it('explicitly calls Create with home when guest selected one — sign-up flow + created=true sets postSignupShown flag', async () => {
			// @spec components/infrastructure/fan/web/global/post-signup-dialog "Sign-up from the landing page"
			// @spec stories/complete-onboarding "Completion latches on sign-in or sign-up"
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com', 'signup'))
			setup('JP-13')
			// Genuinely new account: Create minted a fresh row.
			mockUserService.create = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: true })

			storage.removeItem('postSignup.shown')
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
			expect(mockOnboarding.finish).toHaveBeenCalled()
			expect(result).toBe('/dashboard')
			expect(storage.getItem('postSignup.shown')).toBe('pending')
		})

		describe('sign-up started on an Event page', () => {
			function eventPageUser(returnTo: string) {
				return {
					profile: { email: 'new@example.com' },
					state: { flow: 'signup', origin: 'event-page', returnTo },
				}
			}

			it('returns to the event page with onboarding complete and follows migrated, without arming the post-signup surfaces', async () => {
				// @spec components/infrastructure/fan/web/route/event "Guest signs up to buy"
				// @spec components/infrastructure/fan/web/global/post-signup-dialog "Guest signs up while buying"
				mockAuth.handleCallback = vi
					.fn()
					.mockResolvedValue(eventPageUser('/events/ev-1'))
				setup(null)
				mockUserService.ensureLoaded = vi
					.fn()
					.mockResolvedValue({ user: mockUserService.current, created: true })

				storage.removeItem('postSignup.shown')
				const result = await sut.canLoad({}, {} as RouteNode)

				expect(result).toBe('/events/ev-1')
				expect(mockOnboarding.finish).toHaveBeenCalled()
				expect(mockEa.publish).toHaveBeenCalledWith(
					new GuestMigrationRequested('u1'),
				)
				// Without the flag the Dashboard shows neither the celebration
				// overlay nor the PostSignupDialog later.
				expect(storage.getItem('postSignup.shown')).toBeNull()
			})

			it('ignores a return path that leaves the app', async () => {
				mockAuth.handleCallback = vi
					.fn()
					.mockResolvedValue(eventPageUser('//evil.example.com/x'))

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(result).toBe('/dashboard')
			})

			it('prefers a forced re-auth return-to over the sign-up return path', async () => {
				mockAuth.handleCallback = vi
					.fn()
					.mockResolvedValue(eventPageUser('/events/ev-1'))
				mockAuth.takeReturnTo = vi.fn().mockReturnValue('/tickets')

				const result = await sut.canLoad({}, {} as RouteNode)

				expect(result).toBe('/tickets')
			})
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Dialog shown after first signup"
		it('a NEW no-home account still migrates and shows postSignup (sign-up flow; migration fires regardless of home; created=true)', async () => {
			// New account where the visitor skipped home selection: guestHome is
			// null so provisioning goes through ensureLoaded (not Create), which
			// reports created=true (cache-miss Create path). Arriving via the sign-up
			// flow, the migration trigger and the postSignup flag MUST still fire.
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('new@example.com', 'signup'))
			setup(null)
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: true })

			storage.removeItem('postSignup.shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			// Migration published with the provisioned user id → migration runs.
			expect(mockEa.publish).toHaveBeenCalledWith(
				new GuestMigrationRequested('u1'),
			)
			// Identified first, so the merge's report belongs to the account.
			const analytics = container.get(IAnalyticsService)
			expect(analytics.identify).toHaveBeenCalledWith('u1')
			expect(
				vi.mocked(analytics.identify).mock.invocationCallOrder[0],
			).toBeLessThan(mockEa.publish.mock.invocationCallOrder[0])
			expect(storage.getItem('postSignup.shown')).toBe('pending')
			expect(result).toBe('/dashboard')
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Dialog not shown on subsequent logins"
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

			storage.removeItem('postSignup.shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(mockUserService.create).not.toHaveBeenCalled()
			// Migration fires on sign-in too (Correction 1).
			expect(mockEa.publish).toHaveBeenCalledWith(
				new GuestMigrationRequested('u1'),
			)
			// But no new-account dialog (Correction 2).
			expect(result).toBe('/dashboard')
			expect(storage.getItem('postSignup.shown')).toBeNull()
		})

		// @spec components/infrastructure/fan/web/global/post-signup-dialog "Sign-in with an empty local cache does not trigger the dialog"
		it('a RETURNING sign-in with an EMPTY local cache (created=true) does NOT set postSignup', async () => {
			// A returning user on a new browser/device, with cleared storage, or
			// after guest-then-sign-in: whatever `created` reports (here true, as
			// if the account had just been provisioned), the sign-in flow carries
			// NO sign-up marker, so the celebration MUST stay suppressed.
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('returning@example.com'))
			setup(null)
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: true })

			storage.removeItem('postSignup.shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockUserService.ensureLoaded).toHaveBeenCalled()
			expect(storage.getItem('postSignup.shown')).toBeNull()
			expect(result).toBe('/dashboard')
		})

		it('a callback MISSING the flow marker fails closed — no postSignup even when created=true', async () => {
			// Robustness per design D3: an older in-flight redirect started before
			// this signal existed, or a direct /auth/callback hit, arrives with no
			// marker. Treat it as NOT sign-up (fail closed) — at worst a brand-new
			// user misses the one-time confetti; no returning user is ever celebrated.
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('someone@example.com'))
			setup(null)
			mockUserService.ensureLoaded = vi
				.fn()
				.mockResolvedValue({ user: mockUserService.current, created: true })

			storage.removeItem('postSignup.shown')
			const result = await sut.canLoad({}, {} as RouteNode)

			expect(storage.getItem('postSignup.shown')).toBeNull()
			expect(result).toBe('/dashboard')
		})

		it('redirects to dashboard on error if already authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('callback error'))
			mockAuth.isAuthenticated = true

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe('/dashboard')
			expect(sut.failed).toBe(false)
		})

		it('shows error when callback fails and not authenticated', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockRejectedValue(new Error('auth failed'))
			mockAuth.isAuthenticated = false

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(result).toBe(true)
			expect(sut.failed).toBe(true)
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
			expect(sut.failed).toBe(true)
		})

		it('delegates onboarding completion to merge service (not call complete directly)', async () => {
			mockAuth.handleCallback = vi
				.fn()
				.mockResolvedValue(authUser('user@example.com'))

			const result = await sut.canLoad({}, {} as RouteNode)

			expect(mockOnboarding.finish).toHaveBeenCalled()
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
				// Saved on this device, so a later sign-out opens in it.
				expect(storage.getItem(StorageKeys.language)).toBe('en')
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

describe('AuthCallbackRoute page', () => {
	async function render(lng: 'ja' | 'en', error: Error) {
		const auth = createMockAuth({ isAuthenticated: false })
		auth.handleCallback = vi.fn().mockRejectedValue(error)
		const fixture = await createFixture
			.html('<auth-callback-route></auth-callback-route>')
			.deps(
				I18nConfiguration.customize((options) => {
					options.initOptions = {
						lng,
						fallbackLng: 'ja',
						resources: { ja: { translation: ja }, en: { translation: en } },
					}
				}),
				Registration.instance(IAuthService, auth),
				Registration.instance(IUserStore, createMockUserStore()),
				Registration.instance(IOnboardingService, createMockOnboarding()),
				Registration.instance(IAppConfig, createMockAppConfig()),
				AuthCallbackRoute,
			)
			.build().started
		const host = fixture.appHost.querySelector('auth-callback-route')
		if (!host) throw new Error('auth-callback-route did not render')
		const vm = CustomElement.for<AuthCallbackRoute>(host).viewModel
		await vm.canLoad({}, {} as RouteNode)
		await tasksSettled()
		return { fixture, host }
	}

	// @spec components/infrastructure/fan/web/global/error-messages "Sign-in callback fails"
	it('shows the fixed failure copy and the link home, not the error text', async () => {
		const { fixture, host } = await render(
			'ja',
			new Error('No matching state found in storage'),
		)

		expect(host.querySelector('.callback-error')?.textContent).toBe(
			'サインインできませんでした。ホームに戻って、もう一度お試しください。',
		)
		expect(host.querySelector('a.callback-home-link')?.textContent).toBe(
			'ホームに戻る',
		)
		expect(host.textContent).not.toContain('No matching state')
		await fixture.stop(true)
	})

	it('shows the copy in English for a fan using English', async () => {
		const { fixture, host } = await render('en', new Error('invalid_grant'))

		expect(host.querySelector('.callback-error')?.textContent).toBe(
			'Could not sign in. Return home and try again.',
		)
		expect(host.querySelector('a.callback-home-link')?.textContent).toBe(
			'Return home',
		)
		expect(host.textContent).not.toContain('invalid_grant')
		await fixture.stop(true)
	})
})
