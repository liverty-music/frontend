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

		it('should set entrance animation class when becoming visible', () => {
			sut = create()
			sut.attached()
			expect(sut.animationClass).toBe('animate-fade-slide-up')
		})

		it('should not set animation class when not visible', () => {
			sut = create({ isAuthenticated: false })
			sut.attached()
			expect(sut.animationClass).toBe('')
		})

		it('should set exit animation class on dismiss', () => {
			vi.useFakeTimers()
			sut = create()
			sut.attached()

			sut.dismiss()
			expect(sut.animationClass).toBe('animate-fade-slide-down')
			expect(sut.isVisible).toBe(true) // still visible during animation

			vi.advanceTimersByTime(600)
			expect(sut.isVisible).toBe(false)
			vi.useRealTimers()
		})
	})
})
