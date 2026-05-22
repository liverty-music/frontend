import { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, IEventAggregator, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'
import { createMockI18n } from '../helpers/mock-i18n'

const mockIAuthService = DI.createInterface('IAuthService')
const mockIUserService = DI.createInterface('IUserService')
const mockINotificationManager = DI.createInterface('INotificationManager')
const mockIPushService = DI.createInterface('IPushService')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))
vi.mock('../../src/services/user-service', () => ({
	IUserService: mockIUserService,
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
	}
	let mockUser: {
		current:
			| {
					id: string
					home?: { level1: string }
					preferredLanguage?: string
			  }
			| undefined
		resendEmailVerification: ReturnType<typeof vi.fn>
		clear: ReturnType<typeof vi.fn>
		updatePreferredLanguage: ReturnType<typeof vi.fn>
		revertCachedPreferredLanguage: ReturnType<typeof vi.fn>
	}
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
		}
		mockUser = {
			current: { id: 'user-uuid-1', preferredLanguage: 'ja' },
			resendEmailVerification: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn(),
			updatePreferredLanguage: vi.fn(async (lang: string) => {
				if (mockUser.current) {
					mockUser.current = { ...mockUser.current, preferredLanguage: lang }
				}
				return mockUser.current
			}),
			revertCachedPreferredLanguage: vi.fn((previous: string | undefined) => {
				if (mockUser.current) {
					mockUser.current = {
						...mockUser.current,
						preferredLanguage: previous,
					}
				}
			}),
		}
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
			Registration.instance(mockIUserService, mockUser),
			Registration.instance(mockINotificationManager, mockNotification),
			Registration.instance(mockIPushService, mockPush),
			Registration.instance(IEventAggregator, mockEa),
			Registration.instance(I18N, createMockI18n()),
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

		it('sets currentHome from user service', async () => {
			mockUser.current = { id: 'user-uuid-1', home: { level1: 'JP-13' } }
			await sut.loading()
			expect(sut.currentHome).toBe('tokyo')
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
			// finally still closed the sheet on the way out.
			expect(sut.languageSelectorOpen).toBe(false)
		})
	})

	describe('loading — currentLocale', () => {
		it('sets currentLocale from preferredLanguage when present', async () => {
			mockUser.current = { id: 'user-uuid-1', preferredLanguage: 'en' }
			await sut.loading()
			expect(sut.currentLocale).toBe('en')
		})

		it('falls back to i18n.getLocale() when preferredLanguage is absent', async () => {
			mockUser.current = { id: 'user-uuid-1' } // no preferredLanguage
			await sut.loading()
			expect(sut.currentLocale).toBe('ja') // mock i18n default
		})
	})

	describe('onHomeSelected', () => {
		it('updates currentHome with translation key', () => {
			sut.onHomeSelected('JP-13')
			expect(sut.currentHome).toBeTruthy()
			expect(sut.currentHome).not.toBe('JP-13') // translationKey maps to ISO name
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
})
