import { IStore } from '@aurelia/state'
import { DI, ILogger, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'
import { createMockStore } from '../helpers/mock-store'

const { OnboardingService, OnboardingStep } = await import(
	'../../src/services/onboarding-service'
)
type OnboardingStepValue = (typeof OnboardingStep)[keyof typeof OnboardingStep]

function createService(overrides: { step?: OnboardingStepValue } = {}) {
	const { store, state } = createMockStore({
		onboarding: {
			step: overrides.step ?? OnboardingStep.LP,
			spotlightTarget: '',
			spotlightMessage: '',
			spotlightRadius: '12px',
			spotlightActive: false,
		},
	})

	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(Registration.instance(IStore, store))
	const sut = container.invoke(OnboardingService)

	return { sut, store, state }
}

describe('OnboardingService', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	afterEach(() => {
		localStorage.clear()
	})

	describe('currentStep', () => {
		it('should default to LP (0) when store has initial state', () => {
			const { sut } = createService()
			expect(sut.currentStep).toBe(OnboardingStep.LP)
		})

		it('should reflect store state', () => {
			const { sut } = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.currentStep).toBe(OnboardingStep.DASHBOARD)
		})
	})

	describe('isOnboarding', () => {
		it('should return true for steps 1-5', () => {
			const { sut } = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.isOnboarding).toBe(true)
		})

		it('should return false for COMPLETED (7)', () => {
			const { sut } = createService({ step: OnboardingStep.COMPLETED })
			expect(sut.isOnboarding).toBe(false)
		})

		it('should return false for LP (0)', () => {
			const { sut } = createService()
			expect(sut.isOnboarding).toBe(false)
		})
	})

	describe('setStep', () => {
		it('should dispatch onboarding/advance action', () => {
			const { sut, store } = createService()

			sut.setStep(OnboardingStep.DASHBOARD)

			expect(store.dispatch).toHaveBeenCalledWith({
				type: 'onboarding/advance',
				step: OnboardingStep.DASHBOARD,
			})
			expect(sut.currentStep).toBe(OnboardingStep.DASHBOARD)
		})
	})

	describe('complete', () => {
		it('should dispatch onboarding/complete action', () => {
			const { sut, store } = createService()

			sut.complete()

			expect(store.dispatch).toHaveBeenCalledWith({
				type: 'onboarding/complete',
			})
			expect(sut.currentStep).toBe(OnboardingStep.COMPLETED)
		})
	})

	describe('reset', () => {
		it('should dispatch onboarding/reset action', () => {
			const { sut, store } = createService({ step: OnboardingStep.DASHBOARD })

			sut.reset()

			expect(store.dispatch).toHaveBeenCalledWith({
				type: 'onboarding/reset',
			})
			expect(sut.currentStep).toBe(OnboardingStep.LP)
		})
	})

	describe('spotlight', () => {
		it('should activate spotlight via store dispatch', () => {
			const { sut, store } = createService()

			sut.activateSpotlight('[data-hype-header]', 'Test message')

			expect(store.dispatch).toHaveBeenCalledWith({
				type: 'onboarding/setSpotlight',
				target: '[data-hype-header]',
				message: 'Test message',
				radius: '12px',
			})
			expect(sut.spotlightActive).toBe(true)
			expect(sut.spotlightTarget).toBe('[data-hype-header]')
			expect(sut.spotlightMessage).toBe('Test message')
		})

		it('should deactivate spotlight and clear state', () => {
			const { sut } = createService()
			sut.activateSpotlight('[data-target]', 'msg')

			sut.deactivateSpotlight()

			expect(sut.spotlightActive).toBe(false)
			expect(sut.spotlightTarget).toBe('')
			expect(sut.spotlightMessage).toBe('')
		})

		it('should store onTap callback on instance', () => {
			const { sut } = createService()
			const tapFn = () => {}

			sut.activateSpotlight('[data-target]', 'msg', tapFn)

			expect(sut.onSpotlightTap).toBe(tapFn)
		})

		it('should clear onTap callback on deactivate', () => {
			const { sut } = createService()
			sut.activateSpotlight('[data-target]', 'msg', () => {})

			sut.deactivateSpotlight()

			expect(sut.onSpotlightTap).toBeUndefined()
		})
	})

	describe('getRouteForCurrentStep', () => {
		it('should return "discovery" for DISCOVERY step', () => {
			const { sut } = createService({ step: OnboardingStep.DISCOVERY })
			expect(sut.getRouteForCurrentStep()).toBe('discovery')
		})

		it('should return "dashboard" for DASHBOARD step', () => {
			const { sut } = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.getRouteForCurrentStep()).toBe('dashboard')
		})

		it('should return empty string for LP', () => {
			const { sut } = createService()
			expect(sut.getRouteForCurrentStep()).toBe('')
		})
	})
})
