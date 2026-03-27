import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IAuthService } from '../../src/services/auth-service'
import { IOnboardingService } from '../../src/services/onboarding-service'
import { IPromptCoordinator } from '../../src/services/prompt-coordinator'
import {
	IPwaInstallService,
	PwaInstallService,
} from '../../src/services/pwa-install-service'
import { createMockLogger } from '../helpers/mock-logger'

describe('PwaInstallService', () => {
	let sut: PwaInstallService
	let container: ReturnType<typeof DI.createContainer>
	let addEventListenerSpy: ReturnType<typeof vi.spyOn>
	let mockOnboarding: { isCompleted: boolean }
	let mockAuth: { isAuthenticated: boolean }
	let mockPromptCoordinator: {
		canShowPrompt: ReturnType<typeof vi.fn>
		markShown: ReturnType<typeof vi.fn>
	}

	function fireBeforeInstallPrompt(): {
		preventDefault: ReturnType<typeof vi.fn>
	} {
		const calls = addEventListenerSpy.mock.calls.filter(
			(c) => c[0] === 'beforeinstallprompt',
		)
		const call = calls[calls.length - 1]
		const handler = call![1] as (e: Event) => void
		const fakeEvent = {
			preventDefault: vi.fn(),
			prompt: vi.fn().mockResolvedValue(undefined),
			userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
		}
		handler(fakeEvent as unknown as Event)
		return fakeEvent
	}

	function createService(
		overrides: {
			isCompleted?: boolean
			isAuthenticated?: boolean
			canShowPrompt?: boolean
		} = {},
	): PwaInstallService {
		mockOnboarding = { isCompleted: overrides.isCompleted ?? true }
		mockAuth = { isAuthenticated: overrides.isAuthenticated ?? true }
		mockPromptCoordinator = {
			canShowPrompt: vi.fn().mockReturnValue(overrides.canShowPrompt ?? true),
			markShown: vi.fn(),
		}

		container = DI.createContainer()
		container.register(Registration.instance(ILogger, createMockLogger()))
		container.register(
			Registration.instance(IOnboardingService, mockOnboarding),
		)
		container.register(Registration.instance(IAuthService, mockAuth))
		container.register(
			Registration.instance(IPromptCoordinator, mockPromptCoordinator),
		)
		container.register(PwaInstallService)
		return container.get(IPwaInstallService)
	}

	beforeEach(() => {
		localStorage.clear()
		addEventListenerSpy = vi.spyOn(window, 'addEventListener')
		// Set session count high enough and completedSessionCount to allow prompt
		localStorage.setItem('pwa.completedSessionCount', '1')
		localStorage.setItem('pwa.sessionCount', '2')
		sut = createService()
	})

	afterEach(() => {
		localStorage.clear()
		vi.restoreAllMocks()
	})

	it('should increment session count on construction', () => {
		// Session count was 2, constructor increments to 3
		expect(localStorage.getItem('pwa.sessionCount')).toBe('3')
	})

	it('should accumulate session count across instances', () => {
		localStorage.setItem('pwa.sessionCount', '5')
		createService()
		expect(localStorage.getItem('pwa.sessionCount')).toBe('6')
	})

	it('should register beforeinstallprompt listener', () => {
		expect(addEventListenerSpy).toHaveBeenCalledWith(
			'beforeinstallprompt',
			expect.any(Function),
		)
	})

	it('should not show prompt on first session', () => {
		expect(sut.canShow).toBe(false)
	})

	it('should show prompt when all guards pass and event fires', () => {
		// Session count is 3 (incremented from 2), completedSessionCount is 1
		// 3 >= 1 + 2 = 3, so eligible
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(true)
		expect(mockPromptCoordinator.markShown).toHaveBeenCalledWith('pwa-install')
	})

	it('should not show prompt when dismissed', () => {
		localStorage.setItem('pwa.installPromptDismissed', 'true')
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(false)
	})

	it('should not show prompt when onboarding is not completed', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '5')
		localStorage.setItem('pwa.completedSessionCount', '1')
		sut = createService({ isCompleted: false })
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(false)
	})

	it('should not show prompt when auth is not authenticated', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '5')
		localStorage.setItem('pwa.completedSessionCount', '1')
		sut = createService({ isAuthenticated: false })
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(false)
	})

	it('should not show prompt when promptCoordinator denies it', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '5')
		localStorage.setItem('pwa.completedSessionCount', '1')
		sut = createService({ canShowPrompt: false })
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(false)
	})

	it('should show prompt when all guards pass and sessionCount >= completedSessionCount + 2', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '5')
		localStorage.setItem('pwa.completedSessionCount', '3')
		sut = createService()
		// Session count becomes 6, completedSessionCount is 3, 6 >= 3 + 2 = 5
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(true)
	})

	it('should not show prompt when sessionCount < completedSessionCount + 2', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '3')
		localStorage.setItem('pwa.completedSessionCount', '3')
		sut = createService()
		// Session count becomes 4, completedSessionCount is 3, 4 < 3 + 2 = 5
		fireBeforeInstallPrompt()
		expect(sut.canShow).toBe(false)
	})

	it('should call prompt on install()', async () => {
		const call = addEventListenerSpy.mock.calls.find(
			(c) => c[0] === 'beforeinstallprompt',
		)
		const handler = call![1] as (e: Event) => void

		const fakeEvent = {
			preventDefault: vi.fn(),
			prompt: vi.fn().mockResolvedValue(undefined),
			userChoice: Promise.resolve({ outcome: 'accepted' as const }),
		}
		handler(fakeEvent as unknown as Event)

		await sut.install()

		expect(fakeEvent.prompt).toHaveBeenCalled()
		expect(sut.canShow).toBe(false)
	})

	it('should do nothing if install() called without deferred prompt', async () => {
		await sut.install()
		expect(sut.canShow).toBe(false)
	})

	it('should persist dismissal and hide banner', () => {
		sut.dismiss()

		expect(localStorage.getItem('pwa.installPromptDismissed')).toBe('true')
		expect(sut.canShow).toBe(false)
	})

	it('should persist completedSessionCount when onboarding is completed and not yet persisted', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '3')
		// No completedSessionCount yet
		sut = createService({ isCompleted: true })
		// Constructor increments to 4, then persists completedSessionCount = 4
		expect(localStorage.getItem('pwa.completedSessionCount')).toBe('4')
	})

	it('should not overwrite completedSessionCount if already set', () => {
		localStorage.clear()
		localStorage.setItem('pwa.sessionCount', '3')
		localStorage.setItem('pwa.completedSessionCount', '2')
		sut = createService({ isCompleted: true })
		expect(localStorage.getItem('pwa.completedSessionCount')).toBe('2')
	})
})
