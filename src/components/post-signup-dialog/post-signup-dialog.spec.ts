import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLogger = { info: vi.fn(), error: vi.fn(), scopeTo: vi.fn() }
fakeLogger.scopeTo.mockReturnValue(fakeLogger)

let fakeCanShowFab = true
let fakeIsIos = false
let fakeCanShowInstallOption = true
const fakePwaInstall = {
	get canShowFab() {
		return fakeCanShowFab
	},
	get isIos() {
		return fakeIsIos
	},
	get canShowInstallOption() {
		return fakeCanShowInstallOption
	},
	install: vi.fn().mockResolvedValue(undefined),
}

const fakeNotificationManager = { permission: 'default' }
const fakePushService = {
	create: vi.fn().mockResolvedValue('https://push.example.com/endpoint'),
}
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
		fakeCanShowInstallOption = true
		fakeNotificationManager.permission = 'default'
		vi.clearAllMocks()
		// Restore default mock implementations after clearAllMocks resets them.
		fakeLogger.scopeTo.mockReturnValue(fakeLogger)
		fakePushService.create.mockResolvedValue(
			'https://push.example.com/endpoint',
		)
		sut = new PostSignupDialog()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('canInstallPwa', () => {
		it('returns true when canShowInstallOption is true', () => {
			fakeCanShowInstallOption = true

			expect(sut.canInstallPwa).toBe(true)
		})

		it('returns true when canShowInstallOption is true but canShowFab is false', () => {
			fakeCanShowInstallOption = true
			fakeCanShowFab = false

			expect(sut.canInstallPwa).toBe(true)
		})

		it('returns false when canShowInstallOption is false (installed or unsupported)', () => {
			fakeCanShowInstallOption = false

			expect(sut.canInstallPwa).toBe(false)
		})
	})

	describe('canInstallNatively (watcher)', () => {
		it('starts false before binding', () => {
			expect(sut.canInstallNatively).toBe(false)
		})

		it('initialises from canShowFab && !isIos in binding()', () => {
			fakeCanShowFab = true
			fakeIsIos = false
			sut.binding()

			expect(sut.canInstallNatively).toBe(true)
		})

		it('stays false in binding() on iOS even when canShowFab is true', () => {
			fakeCanShowFab = true
			fakeIsIos = true
			sut.binding()

			expect(sut.canInstallNatively).toBe(false)
		})

		it('becomes true when canShowFab changes to true', () => {
			expect(sut.canInstallNatively).toBe(false)

			fakeCanShowFab = true
			sut.canShowFabChanged()

			expect(sut.canInstallNatively).toBe(true)
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
		})

		it('keeps notificationDone false when permission is denied (create returns null)', async () => {
			fakePushService.create.mockResolvedValueOnce(null)

			await sut.onEnableNotifications()

			expect(sut.notificationDone).toBe(false)
			expect(sut.notificationError).toBe(false)
		})

		it('sets notificationError on failure', async () => {
			fakePushService.create.mockRejectedValueOnce(new Error('denied'))

			await sut.onEnableNotifications()

			expect(sut.notificationError).toBe(true)
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
		it('is false when canShowInstallOption is true', () => {
			fakeCanShowInstallOption = true
			fakeNotificationManager.permission = 'granted'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(false)
		})

		it('is false when permission is not granted', () => {
			fakeCanShowInstallOption = false
			fakeNotificationManager.permission = 'default'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(false)
		})

		it('is true when PWA install option unavailable and notification granted', () => {
			fakeCanShowInstallOption = false
			fakeNotificationManager.permission = 'granted'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(true)
		})

		it('is true when iOS (canShowInstallOption always false) and notification granted', () => {
			fakeCanShowInstallOption = false
			fakeIsIos = true
			fakeNotificationManager.permission = 'granted'
			sut = new PostSignupDialog()

			expect(sut.isAllDone).toBe(true)
		})

		it('becomes true when permission changes to granted after dialog creation', () => {
			fakeCanShowInstallOption = false
			fakeNotificationManager.permission = 'default'
			sut = new PostSignupDialog()
			expect(sut.isAllDone).toBe(false)

			fakeNotificationManager.permission = 'granted'

			expect(sut.isAllDone).toBe(true)
		})
	})
})
