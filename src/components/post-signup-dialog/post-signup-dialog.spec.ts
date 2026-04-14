import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLogger = { info: vi.fn(), error: vi.fn(), scopeTo: vi.fn() }
fakeLogger.scopeTo.mockReturnValue(fakeLogger)

let fakeCanShowFab = true
let fakeIsIos = false
const fakePwaInstall = {
	get canShowFab() {
		return fakeCanShowFab
	},
	get isIos() {
		return fakeIsIos
	},
	install: vi.fn().mockResolvedValue(undefined),
}

const fakeNotificationManager = { permission: 'default' }
const fakePushService = { create: vi.fn().mockResolvedValue(null) }
const fakePromptCoordinator = { markShown: vi.fn() }

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token) => {
			const name = String(token)
			if (name.includes('Logger')) return fakeLogger
			if (name.includes('PwaInstall')) return fakePwaInstall
			if (name.includes('Notification') && name.includes('Manager'))
				return fakeNotificationManager
			if (name.includes('Push')) return fakePushService
			if (name.includes('Coordinator')) return fakePromptCoordinator
			return {}
		}),
		bindable: actual.bindable,
	}
})

import { PostSignupDialog } from './post-signup-dialog'

describe('PostSignupDialog', () => {
	let sut: PostSignupDialog

	beforeEach(() => {
		fakeCanShowFab = true
		fakeIsIos = false
		fakeNotificationManager.permission = 'default'
		vi.clearAllMocks()
		// Restore scopeTo after clearAllMocks resets mock implementations
		fakeLogger.scopeTo.mockReturnValue(fakeLogger)
		sut = new PostSignupDialog()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('canInstallPwa', () => {
		it('returns true when canShowFab is true and not iOS', () => {
			fakeCanShowFab = true
			fakeIsIos = false

			expect(sut.canInstallPwa).toBe(true)
		})

		it('returns false on iOS regardless of canShowFab', () => {
			fakeCanShowFab = true
			fakeIsIos = true

			expect(sut.canInstallPwa).toBe(false)
		})

		it('returns false when canShowFab is false', () => {
			fakeCanShowFab = false
			fakeIsIos = false

			expect(sut.canInstallPwa).toBe(false)
		})
	})

	describe('activeChanged', () => {
		it('opens dialog and marks notification prompt as shown', () => {
			sut.active = true
			sut.activeChanged()

			expect(sut.isOpen).toBe(true)
			expect(fakePromptCoordinator.markShown).toHaveBeenCalledWith(
				'notification',
			)
		})

		it('does NOT mark pwa-install as shown (FAB must stay visible)', () => {
			sut.active = true
			sut.activeChanged()

			expect(fakePromptCoordinator.markShown).not.toHaveBeenCalledWith(
				'pwa-install',
			)
		})

		it('does nothing when active becomes false', () => {
			sut.active = false
			sut.activeChanged()

			expect(sut.isOpen).toBe(false)
		})
	})

	describe('onInstallPwa', () => {
		it('calls pwaInstall.install()', async () => {
			await sut.onInstallPwa()

			expect(fakePwaInstall.install).toHaveBeenCalledOnce()
		})
	})

	describe('onEnableNotifications', () => {
		it('sets notificationDone on success', async () => {
			await sut.onEnableNotifications()

			expect(sut.notificationDone).toBe(true)
			expect(sut.notificationLoading).toBe(false)
		})

		it('sets notificationError on failure', async () => {
			fakePushService.create.mockRejectedValueOnce(new Error('denied'))

			await sut.onEnableNotifications()

			expect(sut.notificationError).toBe(true)
			expect(sut.notificationLoading).toBe(false)
		})
	})

	describe('onDefer', () => {
		it('closes the dialog without suppressing FAB', () => {
			sut.active = true
			sut.activeChanged()

			sut.onDefer()

			expect(sut.isOpen).toBe(false)
		})
	})

	describe('isAllDone', () => {
		it('is false when canInstallPwa is true', () => {
			fakeCanShowFab = true
			fakeIsIos = false
			fakeNotificationManager.permission = 'granted'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(false)
		})

		it('is false when permission is not granted', () => {
			fakeCanShowFab = false
			fakeIsIos = false
			fakeNotificationManager.permission = 'default'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(false)
		})

		it('is true when PWA installed and notification granted', () => {
			fakeCanShowFab = false
			fakeIsIos = false
			fakeNotificationManager.permission = 'granted'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(true)
		})

		it('is true when iOS (canInstallPwa always false) and notification granted', () => {
			fakeCanShowFab = true
			fakeIsIos = true
			fakeNotificationManager.permission = 'granted'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(true)
		})

		it('becomes true when permission changes to granted after dialog creation', () => {
			fakeCanShowFab = false
			fakeIsIos = false
			fakeNotificationManager.permission = 'default'
			sut = new PostSignupDialog()
			expect(sut.isAllDone).toBe(false)

			fakeNotificationManager.permission = 'granted'

			expect(sut.isAllDone).toBe(true)
		})
	})
})
