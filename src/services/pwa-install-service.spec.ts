import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	scopeTo: vi.fn(),
}
fakeLogger.scopeTo.mockReturnValue(fakeLogger)

let fakeOnboardingIsCompleted = false
const fakeOnboarding = {
	get isCompleted() {
		return fakeOnboardingIsCompleted
	},
}

vi.mock('aurelia', async (importOriginal) => {
	const actual = await importOriginal<typeof import('aurelia')>()
	return {
		...actual,
		resolve: vi.fn((token) => {
			const name = String(token)
			if (name.includes('Logger') || name.includes('ILogger')) return fakeLogger
			if (name.includes('Onboarding')) return fakeOnboarding
			return {}
		}),
	}
})

import { StorageKeys } from '../constants/storage-keys'
import { PwaInstallService } from './pwa-install-service'

function makeBeforeInstallPromptEvent() {
	const event = new Event('beforeinstallprompt') as Event & {
		prompt: ReturnType<typeof vi.fn>
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
	}
	event.preventDefault = vi.fn()
	event.prompt = vi.fn().mockResolvedValue(undefined)
	event.userChoice = Promise.resolve({ outcome: 'accepted' as const })
	return event
}

describe('PwaInstallService', () => {
	beforeEach(() => {
		fakeOnboardingIsCompleted = false
		localStorage.clear()
		vi.clearAllMocks()
		// Restore scopeTo after clearAllMocks (clearAllMocks resets mock implementations)
		fakeLogger.scopeTo.mockReturnValue(fakeLogger)
		// jsdom does not implement window.matchMedia
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

	describe('canShowFab — eligibility', () => {
		it('is false when onboarding is not completed', () => {
			fakeOnboardingIsCompleted = false
			const sut = new PwaInstallService()

			window.dispatchEvent(makeBeforeInstallPromptEvent())

			expect(sut.canShowFab).toBe(false)
		})

		it('is true after beforeinstallprompt fires and onboarding is completed', () => {
			fakeOnboardingIsCompleted = true
			const sut = new PwaInstallService()

			window.dispatchEvent(makeBeforeInstallPromptEvent())

			expect(sut.canShowFab).toBe(true)
		})

		it('is false when already installed via localStorage flag', () => {
			localStorage.setItem(StorageKeys.pwaInstalled, 'true')
			fakeOnboardingIsCompleted = true
			const sut = new PwaInstallService()

			window.dispatchEvent(makeBeforeInstallPromptEvent())

			expect(sut.canShowFab).toBe(false)
		})

		it('is false when running in standalone mode', () => {
			vi.spyOn(window, 'matchMedia').mockReturnValue({
				matches: true,
			} as MediaQueryList)
			fakeOnboardingIsCompleted = true
			const sut = new PwaInstallService()

			window.dispatchEvent(makeBeforeInstallPromptEvent())

			expect(sut.canShowFab).toBe(false)
		})
	})

	describe('evaluateAfterOnboarding', () => {
		it('sets canShowFab when beforeinstallprompt already fired and onboarding just completed', () => {
			fakeOnboardingIsCompleted = false
			const sut = new PwaInstallService()
			window.dispatchEvent(makeBeforeInstallPromptEvent())
			expect(sut.canShowFab).toBe(false)

			fakeOnboardingIsCompleted = true
			sut.evaluateAfterOnboarding()

			expect(sut.canShowFab).toBe(true)
		})
	})

	describe('install', () => {
		it('calls deferredPrompt.prompt() and clears canShowFab on accepted', async () => {
			fakeOnboardingIsCompleted = true
			const sut = new PwaInstallService()
			const event = makeBeforeInstallPromptEvent()
			window.dispatchEvent(event)

			await sut.install()

			expect(event.prompt).toHaveBeenCalledOnce()
			expect(sut.canShowFab).toBe(false)
		})

		it('does nothing if no deferredPrompt', async () => {
			const sut = new PwaInstallService()

			await expect(sut.install()).resolves.toBeUndefined()
		})
	})

	describe('appinstalled event', () => {
		it('sets canShowFab to false and persists installed state', () => {
			fakeOnboardingIsCompleted = true
			const sut = new PwaInstallService()
			window.dispatchEvent(makeBeforeInstallPromptEvent())
			expect(sut.canShowFab).toBe(true)

			window.dispatchEvent(new Event('appinstalled'))

			expect(sut.canShowFab).toBe(false)
			expect(localStorage.getItem(StorageKeys.pwaInstalled)).toBe('true')
		})
	})

	describe('isIos', () => {
		it('returns false when BeforeInstallPromptEvent is in window', () => {
			Object.defineProperty(window, 'BeforeInstallPromptEvent', {
				value: class {},
				configurable: true,
			})
			const sut = new PwaInstallService()

			expect(sut.isIos).toBe(false)

			delete (window as unknown as Record<string, unknown>)
				.BeforeInstallPromptEvent
		})
	})
})
