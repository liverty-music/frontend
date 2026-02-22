import { DI, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaSelectorSheet } from '../../src/components/area-selector-sheet/area-selector-sheet'
import { createTestContainer } from '../helpers/create-container'
import { createMockAuth } from '../helpers/mock-auth'

// Mock modules that have unresolvable BSR imports or window.location at module level
const mockIAuthService = DI.createInterface('IAuthService')
const mockIPushService = DI.createInterface('IPushService')
const mockINotificationManager = DI.createInterface('INotificationManager')

vi.mock('../../src/services/auth-service', () => ({
	IAuthService: mockIAuthService,
}))

vi.mock('../../src/services/push-service', () => ({
	IPushService: mockIPushService,
}))

vi.mock('../../src/services/notification-manager', () => ({
	INotificationManager: mockINotificationManager,
}))

vi.mock('../../src/components/area-selector-sheet/area-selector-sheet', () => ({
	AreaSelectorSheet: {
		getStoredArea: vi.fn().mockReturnValue(null),
	},
}))

interface MockNotificationManager {
	permission: NotificationPermission
}

interface MockPushService {
	subscribe: ReturnType<typeof vi.fn>
	unsubscribe: ReturnType<typeof vi.fn>
}

// Must import SettingsPage AFTER mocks are set up
const { SettingsPage } = await import('../../src/routes/settings/settings-page')

describe('SettingsPage', () => {
	let sut: InstanceType<typeof SettingsPage>
	let mockAuth: ReturnType<typeof createMockAuth>
	let mockNotificationManager: MockNotificationManager
	let mockPushService: MockPushService

	beforeEach(() => {
		localStorage.clear()
		mockAuth = createMockAuth()
		mockNotificationManager = { permission: 'default' }
		mockPushService = {
			subscribe: vi.fn().mockResolvedValue(undefined),
			unsubscribe: vi.fn().mockResolvedValue(undefined),
		}

		const container = createTestContainer(
			Registration.instance(mockIAuthService, mockAuth),
			Registration.instance(mockINotificationManager, mockNotificationManager),
			Registration.instance(mockIPushService, mockPushService),
		)
		container.register(SettingsPage)
		sut = container.get(SettingsPage)
	})

	describe('attached', () => {
		it('should load stored area', () => {
			const mockedSheet = vi.mocked(AreaSelectorSheet)
			mockedSheet.getStoredArea.mockReturnValue('東京')

			sut.attached()

			expect(sut.currentArea).toBe('東京')
		})

		it('should set empty string when no area stored', () => {
			const mockedSheet = vi.mocked(AreaSelectorSheet)
			mockedSheet.getStoredArea.mockReturnValue(null)

			sut.attached()

			expect(sut.currentArea).toBe('')
		})

		it('should load notification pref from localStorage', () => {
			localStorage.setItem('liverty-music:notification-enabled', 'true')
			sut.attached()
			expect(sut.notificationsEnabled).toBe(true)
		})

		it('should fall back to notification permission when no stored pref', () => {
			mockNotificationManager.permission = 'granted'
			sut.attached()
			expect(sut.notificationsEnabled).toBe(true)
		})

		it('should default to false when permission is not granted', () => {
			mockNotificationManager.permission = 'default'
			sut.attached()
			expect(sut.notificationsEnabled).toBe(false)
		})
	})

	describe('openAreaSelector', () => {
		it('should call open on area sheet', () => {
			const mockOpen = vi.fn()
			sut.areaSheet = { open: mockOpen } as unknown as AreaSelectorSheet
			sut.openAreaSelector()
			expect(mockOpen).toHaveBeenCalled()
		})
	})

	describe('onAreaSelected', () => {
		it('should update current area', () => {
			sut.onAreaSelected('大阪')
			expect(sut.currentArea).toBe('大阪')
		})
	})

	describe('toggleNotifications', () => {
		it('should subscribe when notifications are off', async () => {
			sut.notificationsEnabled = false
			mockNotificationManager.permission = 'granted'

			await sut.toggleNotifications()

			expect(mockPushService.subscribe).toHaveBeenCalled()
			expect(sut.notificationsEnabled).toBe(true)
			expect(localStorage.getItem('liverty-music:notification-enabled')).toBe(
				'true',
			)
		})

		it('should unsubscribe when notifications are on', async () => {
			sut.notificationsEnabled = true

			await sut.toggleNotifications()

			expect(mockPushService.unsubscribe).toHaveBeenCalled()
			expect(sut.notificationsEnabled).toBe(false)
			expect(localStorage.getItem('liverty-music:notification-enabled')).toBe(
				'false',
			)
		})

		it('should not enable if permission is not granted after subscribe', async () => {
			sut.notificationsEnabled = false
			mockNotificationManager.permission = 'denied'

			await sut.toggleNotifications()

			expect(mockPushService.subscribe).toHaveBeenCalled()
			expect(sut.notificationsEnabled).toBe(false)
		})

		it('should prevent concurrent toggles', async () => {
			sut.notificationsEnabled = false
			mockNotificationManager.permission = 'granted'

			const promise1 = sut.toggleNotifications()
			const promise2 = sut.toggleNotifications()

			await Promise.all([promise1, promise2])

			expect(mockPushService.subscribe).toHaveBeenCalledTimes(1)
		})

		it('should handle errors gracefully', async () => {
			sut.notificationsEnabled = false
			mockPushService.subscribe.mockRejectedValue(new Error('Network error'))

			await sut.toggleNotifications()

			expect(sut.isTogglingNotifications).toBe(false)
		})
	})

	describe('signOut', () => {
		it('should call auth signOut', async () => {
			await sut.signOut()
			expect(mockAuth.signOut).toHaveBeenCalled()
		})
	})
})
