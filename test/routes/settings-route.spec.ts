import { I18N } from '@aurelia/i18n'
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
		current: { home?: { level1: string } } | undefined
		resendEmailVerification: ReturnType<typeof vi.fn>
		clear: ReturnType<typeof vi.fn>
	}
	let mockNotification: { permission: string }
	let mockPush: {
		subscribe: ReturnType<typeof vi.fn>
		unsubscribe: ReturnType<typeof vi.fn>
	}
	let mockEa: { publish: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		mockAuth = {
			isAuthenticated: true,
			user: { profile: { email_verified: true } },
			signOut: vi.fn().mockResolvedValue(undefined),
		}
		mockUser = {
			current: undefined,
			resendEmailVerification: vi.fn().mockResolvedValue(undefined),
			clear: vi.fn(),
		}
		mockNotification = { permission: 'default' }
		mockPush = {
			subscribe: vi.fn().mockResolvedValue(undefined),
			unsubscribe: vi.fn().mockResolvedValue(undefined),
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
		it('sets emailVerified from user profile', () => {
			sut.loading()
			expect(sut.emailVerified).toBe(true)
		})

		it('sets emailVerified false when profile has no claim', () => {
			mockAuth.user = { profile: {} }
			sut.loading()
			expect(sut.emailVerified).toBe(false)
		})

		it('sets currentHome from user service', () => {
			mockUser.current = { home: { level1: 'JP-13' } }
			sut.loading()
			expect(sut.currentHome).toBe('tokyo')
		})

		it('reads notification preference from localStorage', () => {
			localStorage.setItem('user.notificationsEnabled', 'true')
			mockNotification.permission = 'granted'
			sut.loading()
			expect(sut.notificationsEnabled).toBe(true)
		})

		it('overrides stored pref when browser permission revoked', () => {
			localStorage.setItem('user.notificationsEnabled', 'true')
			mockNotification.permission = 'denied'
			sut.loading()
			expect(sut.notificationsEnabled).toBe(false)
		})
	})

	describe('selectLanguage', () => {
		it('changes locale and closes selector', async () => {
			sut.languageSelectorOpen = true
			await sut.selectLanguage('en')
			expect(sut.currentLocale).toBe('en')
			expect(sut.languageSelectorOpen).toBe(false)
		})

		it('does nothing when selecting current locale', async () => {
			sut.languageSelectorOpen = true
			await sut.selectLanguage('ja')
			expect(sut.languageSelectorOpen).toBe(false)
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
		it('subscribes and enables when toggling on with granted permission', async () => {
			mockNotification.permission = 'granted'
			sut.notificationsEnabled = false

			await sut.toggleNotifications()

			expect(mockPush.subscribe).toHaveBeenCalledOnce()
			expect(sut.notificationsEnabled).toBe(true)
		})

		it('unsubscribes when toggling off', async () => {
			sut.notificationsEnabled = true

			await sut.toggleNotifications()

			expect(mockPush.unsubscribe).toHaveBeenCalledOnce()
			expect(sut.notificationsEnabled).toBe(false)
		})

		it('prevents concurrent toggles', async () => {
			mockPush.subscribe.mockImplementation(
				() => new Promise((r) => setTimeout(r, 100)),
			)

			const p1 = sut.toggleNotifications()
			const p2 = sut.toggleNotifications()
			await Promise.all([p1, p2])

			expect(mockPush.subscribe).toHaveBeenCalledOnce()
		})
	})

	describe('resendVerification', () => {
		it('calls resendEmailVerification and sets success', async () => {
			await sut.resendVerification()
			expect(mockUser.resendEmailVerification).toHaveBeenCalledOnce()
			expect(sut.resendSuccess).toBe(true)
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
