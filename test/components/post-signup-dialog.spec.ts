import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContainer } from '../helpers/create-container'

const mockINotificationManager = DI.createInterface('INotificationManager')
const mockIPushService = DI.createInterface('IPushService')
const mockIPwaInstallService = DI.createInterface('IPwaInstallService')
const mockIPromptCoordinator = DI.createInterface('IPromptCoordinator')

vi.mock('../../src/services/notification-manager', () => ({
	INotificationManager: mockINotificationManager,
}))
vi.mock('../../src/services/push-service', () => ({
	IPushService: mockIPushService,
}))
vi.mock('../../src/services/pwa-install-service', () => ({
	IPwaInstallService: mockIPwaInstallService,
}))
vi.mock('../../src/services/prompt-coordinator', () => ({
	IPromptCoordinator: mockIPromptCoordinator,
}))

const { PostSignupDialog } = await import(
	'../../src/components/post-signup-dialog/post-signup-dialog'
)

describe('PostSignupDialog', () => {
	let sut: InstanceType<typeof PostSignupDialog>
	let mockPush: { create: ReturnType<typeof vi.fn> }
	let mockPwa: {
		canShowFab: boolean
		isIos: boolean
		install: ReturnType<typeof vi.fn>
	}
	let mockCoordinator: { markShown: ReturnType<typeof vi.fn> }
	let mockNotification: { permission: string }

	beforeEach(() => {
		mockPush = { create: vi.fn().mockResolvedValue(null) }
		mockPwa = {
			canShowFab: false,
			isIos: false,
			install: vi.fn().mockResolvedValue(undefined),
		}
		mockCoordinator = { markShown: vi.fn() }
		mockNotification = { permission: 'default' }

		const container = createTestContainer(
			Registration.instance(mockINotificationManager, mockNotification),
			Registration.instance(mockIPushService, mockPush),
			Registration.instance(mockIPwaInstallService, mockPwa),
			Registration.instance(mockIPromptCoordinator, mockCoordinator),
		)
		container.register(PostSignupDialog)
		sut = container.get(PostSignupDialog)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('activeChanged', () => {
		it('opens dialog when active becomes true', () => {
			sut.active = true
			sut.activeChanged()

			expect(sut.isOpen).toBe(true)
		})

		it('marks notification prompt as shown (FAB is not suppressed)', () => {
			sut.active = true
			sut.activeChanged()

			expect(mockCoordinator.markShown).toHaveBeenCalledWith('notification')
			expect(mockCoordinator.markShown).not.toHaveBeenCalledWith('pwa-install')
		})

		it('does nothing when active is false', () => {
			sut.active = false
			sut.activeChanged()

			expect(sut.isOpen).toBe(false)
		})
	})

	describe('onEnableNotifications', () => {
		it('subscribes to push and sets done on success', async () => {
			await sut.onEnableNotifications()

			expect(mockPush.create).toHaveBeenCalledOnce()
			expect(sut.notificationDone).toBe(true)
			expect(sut.notificationLoading).toBe(false)
		})

		it('sets error on failure', async () => {
			mockPush.create.mockRejectedValue(new Error('denied'))

			await sut.onEnableNotifications()

			expect(sut.notificationError).toBe(true)
			expect(sut.notificationDone).toBe(false)
			expect(sut.notificationLoading).toBe(false)
		})
	})

	describe('canInstallPwa', () => {
		it('reflects pwaInstall.canShowFab (false when not eligible)', () => {
			expect(sut.canInstallPwa).toBe(false)
		})

		it('is true when canShowFab is true and not iOS', () => {
			mockPwa.canShowFab = true
			expect(sut.canInstallPwa).toBe(true)
		})

		it('is false when canShowFab is true but iOS (iOS uses FAB sheet instead)', () => {
			mockPwa.canShowFab = true
			mockPwa.isIos = true
			expect(sut.canInstallPwa).toBe(false)
		})
	})

	describe('onInstallPwa', () => {
		it('delegates to pwaInstall.install', async () => {
			await sut.onInstallPwa()
			expect(mockPwa.install).toHaveBeenCalledOnce()
		})
	})

	describe('onDefer', () => {
		it('closes the dialog', () => {
			sut.isOpen = true
			sut.onDefer()
			expect(sut.isOpen).toBe(false)
		})
	})
})
