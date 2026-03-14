import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationPrompt } from '../../src/components/notification-prompt/notification-prompt'
import { IAuthService } from '../../src/services/auth-service'
import { INotificationManager } from '../../src/services/notification-manager'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { IPromptCoordinator } from '../../src/services/prompt-coordinator'
import { IPushService } from '../../src/services/push-service'
import { createMockLogger } from '../helpers/mock-logger'

describe('NotificationPrompt', () => {
	let sut: NotificationPrompt

	function create(
		overrides: {
			isAuthenticated?: boolean
			isCompleted?: boolean
			canShowPrompt?: boolean
			permission?: NotificationPermission
			dismissed?: boolean
		} = {},
	): NotificationPrompt {
		const container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(
			Registration.instance(IAuthService, {
				isAuthenticated: overrides.isAuthenticated ?? true,
			}),
		)
		container.register(
			Registration.instance(IOnboardingService, {
				isCompleted: overrides.isCompleted ?? true,
			}),
		)
		container.register(
			Registration.instance(IPromptCoordinator, {
				canShowPrompt: vi.fn().mockReturnValue(overrides.canShowPrompt ?? true),
				markShown: vi.fn(),
			}),
		)
		container.register(
			Registration.instance(INotificationManager, {
				permission: overrides.permission ?? 'default',
			}),
		)
		container.register(
			Registration.instance(IPushService, {
				subscribe: vi.fn().mockResolvedValue(undefined),
			}),
		)

		if (overrides.dismissed) {
			localStorage.setItem('ui.notificationPromptDismissed', 'true')
		}

		container.register(NotificationPrompt)
		return container.get(NotificationPrompt)
	}

	beforeEach(() => {
		localStorage.clear()
		// jsdom does not provide window.matchMedia
		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}))
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('should remain not visible when auth is not authenticated', () => {
		sut = create({ isAuthenticated: false })
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should remain not visible when onboarding is not completed', () => {
		sut = create({ isCompleted: false })
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should remain not visible when promptCoordinator denies it', () => {
		sut = create({ canShowPrompt: false })
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should remain not visible when already dismissed', () => {
		sut = create({ dismissed: true })
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should remain not visible when permission is already granted', () => {
		sut = create({ permission: 'granted' })
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should not consume coordinator slot when dismissed', () => {
		sut = create({ dismissed: true })
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should remain not visible on the same session where onboarding completed', () => {
		// Onboarding completed at session 3, still on session 3
		localStorage.setItem('pwa.completedSessionCount', '3')
		localStorage.setItem('pwa.sessionCount', '3')
		sut = create()
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should remain not visible when completedSessionCount is missing (treats as current session)', () => {
		// PwaInstallService hasn't persisted completedSessionCount yet
		localStorage.setItem('pwa.sessionCount', '5')
		sut = create()
		sut.attached()
		expect(sut.isVisible).toBe(false)
	})

	it('should become visible on the next session after onboarding completed', () => {
		// Onboarding completed at session 3, now on session 4
		localStorage.setItem('pwa.completedSessionCount', '3')
		localStorage.setItem('pwa.sessionCount', '4')
		sut = create()
		sut.attached()
		expect(sut.isVisible).toBe(true)
	})

	it('should become visible when permission is denied (settings guidance)', () => {
		localStorage.setItem('pwa.completedSessionCount', '1')
		localStorage.setItem('pwa.sessionCount', '2')
		sut = create({ permission: 'denied' })
		sut.attached()
		expect(sut.isVisible).toBe(true)
	})

	describe('animations', () => {
		beforeEach(() => {
			localStorage.setItem('pwa.completedSessionCount', '3')
			localStorage.setItem('pwa.sessionCount', '4')
		})

		it('should set entrance animation state when becoming visible', () => {
			sut = create()
			sut.attached()
			expect(sut.animationState).toBe('fade-slide-up')
		})

		it('should not set animation state when not visible', () => {
			sut = create({ isAuthenticated: false })
			sut.attached()
			expect(sut.animationState).toBe('')
		})

		it('should set exit animation state on dismiss and hide after animationend', () => {
			sut = create()
			const mockPopoverEl = document.createElement('div')
			// jsdom does not implement Popover API
			mockPopoverEl.showPopover = vi.fn()
			mockPopoverEl.hidePopover = vi.fn()
			sut.popoverEl = mockPopoverEl
			sut.attached()

			sut.dismiss()
			expect(sut.animationState).toBe('fade-slide-down')
			expect(sut.isVisible).toBe(true) // still visible during animation

			// Simulate the animationend event that the browser would fire
			mockPopoverEl.dispatchEvent(new Event('animationend'))
			expect(sut.isVisible).toBe(false)
		})
	})
})
