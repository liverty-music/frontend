import { Code, ConnectError } from '@connectrpc/connect'
import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIUserStore = DI.createInterface('IUserStore')
const mockINotificationManager = DI.createInterface('INotificationManager')
const mockIPushService = DI.createInterface('IPushService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/user-store', () => ({
	IUserStore: mockIUserStore,
}))
vi.mock('../../src/services/notification-manager', () => ({
	INotificationManager: mockINotificationManager,
}))
vi.mock('../../src/services/push-service', () => ({
	IPushService: mockIPushService,
}))

vi.mock('../../src/components/user-home-selector/user-home-selector', () => ({
	UserHomeSelector: {
		getStoredHome: vi.fn().mockReturnValue(null),
	},
}))

const { SettingsRoute } = await import(
	'../../src/routes/settings/settings-route'
)

describe('SettingsRoute', () => {
	let sut: InstanceType<typeof SettingsRoute>
	let mockAuth: {
		isAuthenticated: boolean
		user: { profile: Record<string, unknown> } | null
		signOut: ReturnType<typeof vi.fn>
		signIn: ReturnType<typeof vi.fn>
		signUp: ReturnType<typeof vi.fn>
	}
	// Lightweight stand-in for the real UserStore: it is the single owner of
	// both the authenticated User entity (current / updatePreferredLanguage /
	// resendEmailVerification / clear, absorbed from the former UserService)
	// AND the guest home/language slice. Its getters resolve the same
	// observable sources (its own `current` / guest fields / mockAuth) the
	// production store uses, so the SettingsRoute getters that delegate to the
	// store — plus the guest changeLocale write-through — exercise the same
	// resolution logic under test.
	let mockUserStore: {
		current:
			| {
					id: string
					home?: { level1: string }
					preferredLanguage?: string
			  }
			| undefined
		guestHome: string | null
		guestLanguage: string | null
		readonly currentHome: string | null
		readonly currentLanguage: string
		setGuestHome: ReturnType<typeof vi.fn>
		setGuestLanguage: ReturnType<typeof vi.fn>
		resendEmailVerification: ReturnType<typeof vi.fn>
		clear: ReturnType<typeof vi.fn>
		updatePreferredLanguage: ReturnType<typeof vi.fn>
	}
	// Alias to the merged store so the existing entity-bootstrap assertions
	// (mockUser.current / updatePreferredLanguage / resendEmailVerification /
	// clear) read naturally against the one IUserStore the route injects.
	let mockUser: typeof mockUserStore
	let mockNotification: { permission: string }
	let mockPush: {
		getBrowserSubscription: ReturnType<typeof vi.fn>
		existsOnBackend: ReturnType<typeof vi.fn>
		createFrom: ReturnType<typeof vi.fn>
		create: ReturnType<typeof vi.fn>
		delete: ReturnType<typeof vi.fn>
	}
	let mockEa: { publish: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockAuth = {
			isAuthenticated: true,
			user: { profile: { email_verified: true } },
			signOut: vi.fn().mockResolvedValue(undefined),
			signIn: vi.fn().mockResolvedValue(undefined),
			signUp: vi.fn().mockResolvedValue(undefined),
		}
		mockUserStore = {
			current: { id: 'user-uuid-1', preferredLanguage: 'ja' },
			guestHome: null,
			guestLanguage: null,
			get currentHome(): string | null {
				return mockAuth.isAuthenticated
					? (mockUserStore.current?.home?.level1 ?? null)
					: mockUserStore.guestHome
			},
			get currentLanguage(): string {
				if (mockAuth.isAuthenticated) {
					return mockUserStore.current?.preferredLanguage ?? 'ja'
				}
				return mockUserStore.guestLanguage ?? 'ja'
			},
			setGuestHome: vi.fn((code: string) => {
				mockUserStore.guestHome = code
			}),
			setGuestLanguage: vi.fn((lang: string) => {
				mockUserStore.guestLanguage = lang
			}),
			resendEmailVerification: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn(),
			updatePreferredLanguage: vi.fn(async (lang: string) => {
				if (mockUserStore.current) {
					mockUserStore.current = {
						...mockUserStore.current,
						preferredLanguage: lang,
					}
				}
				return mockUserStore.current
			}),
		}
		mockUser = mockUserStore
		mockNotification = { permission: 'default' }
		mockPush = {
			getBrowserSubscription: vi.fn().mockResolvedValue(null),
			existsOnBackend: vi.fn().mockResolvedValue(false),
			createFrom: vi.fn().mockResolvedValue(undefined),
			create: vi.fn().mockResolvedValue('https://push.example.com/endpoint'),
			delete: vi.fn().mockResolvedValue(undefined),
		}
		mockEa = { publish: vi.fn() }

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockIUserStore, mockUserStore),
			Registration.instance(mockINotificationManager, mockNotification),
			Registration.instance(mockIPushService, mockPush),
			Registration.instance(IEventAggregator, mockEa),
		)
		container.register(SettingsRoute)
		sut = container.get(SettingsRoute)
	})

	afterEach(() => {
		vi.restoreAllMocks()
		localStorage.clear()
	})

	describe('loading', () => {
		it('sets emailVerified from user profile', async () => {
			await sut.loading()
			expect(sut.emailVerified).toBe(true)
		})

		it('sets emailVerified false when profile has no claim', async () => {
			mockAuth.user = { profile: {} }
			await sut.loading()
			expect(sut.emailVerified).toBe(false)
		})

		it('derives currentHome from userService.current.home (no loading() copy)', async () => {
			// currentHome is a computed getter — set userService.current.home
			// and the getter reflects it on next read. loading() is intentionally
			// not required to surface the value (no local mirror).
			mockUser.current = { id: 'user-uuid-1', home: { level1: 'JP-13' } }
			expect(sut.currentHome).toBe('tokyo')
		})

		it('returns null currentHome when userService.current has no home', async () => {
			// Authenticated route: no guest-storage fallback. If hydration has
			// not populated home, the getter is null (UI renders 'Not set').
			mockUser.current = { id: 'user-uuid-1' }
			expect(sut.currentHome).toBeNull()
		})

		it('sets toggle OFF when permission is not granted', async () => {
			mockNotification.permission = 'denied'
			await sut.loading()
			expect(sut.notificationsEnabled).toBe(false)
			expect(mockPush.getBrowserSubscription).not.toHaveBeenCalled()
		})

		it('sets toggle OFF when browser has no subscription', async () => {
			mockNotification.permission = 'granted'
			mockPush.getBrowserSubscription.mockResolvedValue(null)
			await sut.loading()
			expect(sut.notificationsEnabled).toBe(false)
			expect(mockPush.existsOnBackend).not.toHaveBeenCalled()
		})

		it('sets toggle ON when browser subscription exists on backend', async () => {
			mockNotification.permission = 'granted'
			mockPush.getBrowserSubscription.mockResolvedValue({
				endpoint: 'https://push.example.com/endpoint',
				p256dh: 'key',
				auth: 'secret',
			})
			mockPush.existsOnBackend.mockResolvedValue(true)
			await sut.loading()
			expect(sut.notificationsEnabled).toBe(true)
			expect(mockPush.existsOnBackend).toHaveBeenCalledWith(
				'user-uuid-1',
				'https://push.example.com/endpoint',
			)
			expect(mockPush.createFrom).not.toHaveBeenCalled()
		})

		it('self-heals via createFrom when browser has subscription but backend does not', async () => {
			mockNotification.permission = 'granted'
			const sub = {
				endpoint: 'https://push.example.com/endpoint',
				p256dh: 'key',
				auth: 'secret',
			}
			mockPush.getBrowserSubscription.mockResolvedValue(sub)
			mockPush.existsOnBackend.mockResolvedValue(false)
			await sut.loading()
			expect(mockPush.createFrom).toHaveBeenCalledWith(sub)
			expect(sut.notificationsEnabled).toBe(true)
		})

		it('sets toggle OFF when self-heal fails', async () => {
			mockNotification.permission = 'granted'
			mockPush.getBrowserSubscription.mockResolvedValue({
				endpoint: 'https://push.example.com/endpoint',
				p256dh: 'key',
				auth: 'secret',
			})
			mockPush.existsOnBackend.mockResolvedValue(false)
			mockPush.createFrom.mockRejectedValue(new Error('boom'))
			await sut.loading()
			expect(sut.notificationsEnabled).toBe(false)
		})
	})

	describe('selectLanguage', () => {
		it('changes locale and closes selector', async () => {
			await sut.loading()
			sut.languageSelectorOpen = true
			await sut.selectLanguage('en')
			expect(mockUser.updatePreferredLanguage).toHaveBeenCalledWith('en')
			expect(sut.currentLocale).toBe('en')
			expect(sut.languageSelectorOpen).toBe(false)
		})

		it('does nothing when selecting current locale', async () => {
			// loading() must run first so currentLocale is sourced from
			// userService.current.preferredLanguage = 'ja'. Otherwise the
			// guard would compare against the class-field default ('') and
			// erroneously fire the RPC, giving the test false confidence.
			await sut.loading()
			sut.languageSelectorOpen = true
			await sut.selectLanguage('ja')
			expect(mockUser.updatePreferredLanguage).not.toHaveBeenCalled()
			expect(mockEa.publish).not.toHaveBeenCalled()
			expect(sut.languageSelectorOpen).toBe(false)
		})

		it('publishes a Snack and leaves locale unchanged on ConnectError', async () => {
			await sut.loading()
			mockUser.updatePreferredLanguage.mockRejectedValueOnce(
				new ConnectError('rate limited', Code.ResourceExhausted),
			)
			sut.languageSelectorOpen = true

			await sut.selectLanguage('en')

			expect(mockEa.publish).toHaveBeenCalledTimes(1)
			expect(sut.currentLocale).toBe('ja') // unchanged
			expect(sut.languageSelectorOpen).toBe(false)
		})

		it('rethrows non-ConnectError so programmer errors surface', async () => {
			await sut.loading()
			const bug = new TypeError('missing dep')
			mockUser.updatePreferredLanguage.mockRejectedValueOnce(bug)
			sut.languageSelectorOpen = true

			await expect(sut.selectLanguage('en')).rejects.toBe(bug)
			expect(mockEa.publish).not.toHaveBeenCalled()
			expect(sut.languageSelectorOpen).toBe(false)
		})
	})

	describe('currentLocale getter', () => {
		it('derives currentLocale from preferredLanguage when present', () => {
			mockUser.current = { id: 'user-uuid-1', preferredLanguage: 'en' }
			expect(sut.currentLocale).toBe('en')
		})

		it('falls back to normalized i18n.getLocale() when preferredLanguage is absent', () => {
			// Hydration race window: user row exists but preferred_language is
			// NULL on the wire (legacy row pending backfill, or the
			// UpdatePreferredLanguage RPC is still in flight). The getter
			// must surface the active i18n locale rather than empty string —
			// otherwise no selector option would highlight.
			mockUser.current = { id: 'user-uuid-1' }
			expect(sut.currentLocale).toBe('ja') // mock i18n default
		})

		it('reflects userService.current changes WITHOUT loading() re-run (single source of truth)', () => {
			// Regression for the desync that mirrored state caused on
			// 2026-05-25: changing the entity must be visible immediately
			// through the getter, with no manual re-copy step.
			mockUser.current = { id: 'user-uuid-1', preferredLanguage: 'ja' }
			expect(sut.currentLocale).toBe('ja')
			mockUser.current = { id: 'user-uuid-1', preferredLanguage: 'en' }
			expect(sut.currentLocale).toBe('en')
		})
	})

	describe('onHomeSelected', () => {
		it('is a notification-only handler — UserHomeSelector owns the userService.updateHome call', () => {
			// The old behavior wrote `currentHome` directly here; that has
			// moved into the derived getter. Calling onHomeSelected with
			// arbitrary code must NOT mutate observable state — the only
			// observable effect is a log line (asserted by absence of state
			// change rather than positive assertion to avoid coupling to
			// logger internals).
			mockUser.current = { id: 'user-uuid-1' }
			const before = sut.currentHome
			sut.onHomeSelected('JP-13')
			expect(sut.currentHome).toBe(before)
		})
	})

	describe('toggleNotifications', () => {
		it('creates and enables when toggling on with granted permission', async () => {
			mockNotification.permission = 'granted'
			sut.notificationsEnabled = false

			await sut.toggleNotifications()

			expect(mockPush.create).toHaveBeenCalledOnce()
			expect(sut.notificationsEnabled).toBe(true)
		})

		it('keeps toggle OFF when create returns null (permission denied)', async () => {
			mockPush.create.mockResolvedValue(null)
			sut.notificationsEnabled = false

			await sut.toggleNotifications()

			expect(mockPush.create).toHaveBeenCalledOnce()
			expect(sut.notificationsEnabled).toBe(false)
		})

		it('deletes the current browser subscription when toggling off', async () => {
			sut.notificationsEnabled = true

			await sut.toggleNotifications()

			expect(mockPush.delete).toHaveBeenCalledWith('user-uuid-1')
			expect(sut.notificationsEnabled).toBe(false)
		})

		it('prevents concurrent toggles', async () => {
			mockPush.create.mockImplementation(
				() => new Promise((r) => setTimeout(() => r('ep'), 100)),
			)

			const p1 = sut.toggleNotifications()
			const p2 = sut.toggleNotifications()
			await Promise.all([p1, p2])

			expect(mockPush.create).toHaveBeenCalledOnce()
		})

		it('skips toggle when userId is not yet available', async () => {
			mockUser.current = undefined
			sut.notificationsEnabled = false

			await sut.toggleNotifications()

			expect(mockPush.create).not.toHaveBeenCalled()
			expect(mockPush.delete).not.toHaveBeenCalled()
		})
	})

	describe('resendVerification', () => {
		it('calls resendEmailVerification and sets success', async () => {
			await sut.resendVerification()
			expect(mockUser.resendEmailVerification).toHaveBeenCalledOnce()
			expect(sut.resendSuccess).toBe(true)
		})

		it('publishes rate-limit snack on ResourceExhausted', async () => {
			mockUser.resendEmailVerification.mockRejectedValue(
				new ConnectError('rate limited', Code.ResourceExhausted),
			)
			await sut.resendVerification()
			expect(sut.resendSuccess).toBe(false)
			expect(mockEa.publish).toHaveBeenCalled()
		})
	})

	describe('signOut', () => {
		it('clears user service and calls auth signOut', async () => {
			await sut.signOut()
			expect(mockUser.clear).toHaveBeenCalledOnce()
			expect(mockAuth.signOut).toHaveBeenCalledOnce()
		})
	})

	describe('guest mode', () => {
		function buildGuestSut() {
			mockAuth.isAuthenticated = false
			mockAuth.user = null
			const container = createTestContainer(
				Registration.instance(mockIAuthService, mockAuth),
				Registration.instance(mockIUserStore, mockUserStore),
				Registration.instance(mockINotificationManager, mockNotification),
				Registration.instance(mockIPushService, mockPush),
				Registration.instance(IEventAggregator, mockEa),
			)
			container.register(SettingsRoute)
			return container.get(SettingsRoute)
		}

		it('signIn() starts the OIDC sign-in flow', async () => {
			const guestSut = buildGuestSut()
			await guestSut.signIn()
			expect(mockAuth.signIn).toHaveBeenCalledOnce()
		})

		it('signUp() starts the OIDC sign-up flow', async () => {
			const guestSut = buildGuestSut()
			await guestSut.signUp()
			expect(mockAuth.signUp).toHaveBeenCalledOnce()
		})

		it('language change does not call the backend RPC for a guest', async () => {
			const guestSut = buildGuestSut()
			await guestSut.selectLanguage('en')
			expect(mockUser.updatePreferredLanguage).not.toHaveBeenCalled()
		})

		it('guest language change writes through the observable guest source and the selector reflects it (reactive)', async () => {
			const guestSut = buildGuestSut()
			// Before the change the guest has made no explicit choice; the
			// selector highlight falls back to the active i18n locale ('ja').
			expect(guestSut.currentLocale).toBe('ja')

			await guestSut.selectLanguage('en')

			// changeLocale writes through UserStore.setGuestLanguage (the
			// @observable owner) rather than raw localStorage, so the store —
			// and therefore the Settings selector binding — reflects the new
			// language immediately. This is the guest language-selector
			// reactivity fix.
			expect(mockUserStore.setGuestLanguage).toHaveBeenCalledWith('en')
			expect(guestSut.currentLocale).toBe('en')
		})
	})

	describe('consent description disclosure', () => {
		it('toggleAnalyticsDesc flips the analytics disclosure state', () => {
			expect(sut.analyticsDescExpanded).toBe(false)
			sut.toggleAnalyticsDesc()
			expect(sut.analyticsDescExpanded).toBe(true)
			sut.toggleAnalyticsDesc()
			expect(sut.analyticsDescExpanded).toBe(false)
		})

		it('disclosure toggle does not change the switch value (independent controls)', () => {
			sut.marketingConsent = false
			sut.toggleMarketingDesc()
			expect(sut.marketingDescExpanded).toBe(true)
			// The disclosure and the switch are separate controls — expanding
			// the description must not grant/revoke the consent.
			expect(sut.marketingConsent).toBe(false)
		})
	})

	describe('isIOS', () => {
		afterEach(() => {
			// Drop any own-property override, restoring the prototype getter.
			delete (navigator as { userAgent?: string }).userAgent
		})

		it('is false on a non-iOS user agent', () => {
			expect(sut.isIOS).toBe(false)
		})

		it('is true on an iPhone user agent', () => {
			Object.defineProperty(navigator, 'userAgent', {
				configurable: true,
				get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
			})
			expect(sut.isIOS).toBe(true)
		})
	})
})
