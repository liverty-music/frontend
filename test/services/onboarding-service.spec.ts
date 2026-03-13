import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StorageKeys } from '../../src/constants/storage-keys'
import { createMockLogger } from '../helpers/mock-logger'

// Import the real service (not mocked) for integration-style tests
const { OnboardingService, OnboardingStep } = await import(
	'../../src/services/onboarding-service'
)

function createService(): InstanceType<typeof OnboardingService> {
	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	return container.invoke(OnboardingService)
}

describe('OnboardingService', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		localStorage.clear()
	})

	describe('backward compatibility', () => {
		it('should upgrade step 6 (SIGNUP) to step 7 (COMPLETED) on init', () => {
			localStorage.setItem(StorageKeys.onboardingStep, '6')

			const sut = createService()

			expect(sut.currentStep).toBe(OnboardingStep.COMPLETED) // 7
			expect(localStorage.getItem(StorageKeys.onboardingStep)).toBe('7')
		})

		it('should preserve step 5 (MY_ARTISTS) without upgrade', () => {
			localStorage.setItem(StorageKeys.onboardingStep, '5')

			const sut = createService()

			expect(sut.currentStep).toBe(OnboardingStep.MY_ARTISTS)
			expect(localStorage.getItem(StorageKeys.onboardingStep)).toBe('5')
		})

		it('should preserve step 7 (COMPLETED) without modification', () => {
			localStorage.setItem(StorageKeys.onboardingStep, '7')

			const sut = createService()

			expect(sut.currentStep).toBe(OnboardingStep.COMPLETED)
			expect(localStorage.getItem(StorageKeys.onboardingStep)).toBe('7')
		})

		it('should default to LP (0) when no localStorage value exists', () => {
			const sut = createService()

			expect(sut.currentStep).toBe(OnboardingStep.LP)
		})
	})

	describe('isOnboarding', () => {
		it('should return true for steps 1-5', () => {
			localStorage.setItem(StorageKeys.onboardingStep, '3')
			const sut = createService()
			expect(sut.isOnboarding).toBe(true)
		})

		it('should return false for COMPLETED (7)', () => {
			localStorage.setItem(StorageKeys.onboardingStep, '7')
			const sut = createService()
			expect(sut.isOnboarding).toBe(false)
		})

		it('should return false for LP (0)', () => {
			const sut = createService()
			expect(sut.isOnboarding).toBe(false)
		})
	})

	describe('setStep', () => {
		it('should update currentStep and persist to localStorage', () => {
			const sut = createService()

			sut.setStep(OnboardingStep.DASHBOARD)

			expect(sut.currentStep).toBe(OnboardingStep.DASHBOARD)
			expect(localStorage.getItem(StorageKeys.onboardingStep)).toBe('3')
		})
	})

	describe('complete', () => {
		it('should set step to COMPLETED', () => {
			const sut = createService()

			sut.complete()

			expect(sut.currentStep).toBe(OnboardingStep.COMPLETED)
			expect(localStorage.getItem(StorageKeys.onboardingStep)).toBe('7')
		})
	})

	describe('spotlight', () => {
		it('should activate spotlight with target and message', () => {
			const sut = createService()

			sut.activateSpotlight('[data-hype-header]', 'Test message')

			expect(sut.spotlightActive).toBe(true)
			expect(sut.spotlightTarget).toBe('[data-hype-header]')
			expect(sut.spotlightMessage).toBe('Test message')
		})

		it('should deactivate spotlight and clear state', () => {
			const sut = createService()
			sut.activateSpotlight('[data-target]', 'msg')

			sut.deactivateSpotlight()

			expect(sut.spotlightActive).toBe(false)
			expect(sut.spotlightTarget).toBe('')
			expect(sut.spotlightMessage).toBe('')
		})
	})
})
