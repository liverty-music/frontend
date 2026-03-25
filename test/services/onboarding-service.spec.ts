import { DI, ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingStep } from '../../src/entities/onboarding'
import { createMockLogger } from '../helpers/mock-logger'

vi.mock('../../src/adapter/storage/onboarding-storage', () => ({
	loadStep: vi.fn().mockReturnValue('lp'),
	saveStep: vi.fn(),
}))

const { loadStep } = await import(
	'../../src/adapter/storage/onboarding-storage'
)

// Dynamic import so that the module-level loadStep() call uses our mock
const { OnboardingService } = await import(
	'../../src/services/onboarding-service'
)

function createService(
	overrides: { step?: string } = {},
): InstanceType<typeof OnboardingService> {
	// Reset to default, then apply override
	vi.mocked(loadStep).mockReturnValue((overrides.step ?? 'lp') as never)
	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	return container.invoke(OnboardingService)
}

describe('OnboardingService', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('currentStep', () => {
		it('should default to LP when no override', () => {
			const sut = createService()
			expect(sut.currentStep).toBe(OnboardingStep.LP)
		})

		it('should reflect the step passed at creation', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.currentStep).toBe(OnboardingStep.DASHBOARD)
		})
	})

	describe('isOnboarding', () => {
		it('should return true for DISCOVERY', () => {
			const sut = createService({ step: OnboardingStep.DISCOVERY })
			expect(sut.isOnboarding).toBe(true)
		})

		it('should return true for DASHBOARD', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.isOnboarding).toBe(true)
		})

		it('should return true for MY_ARTISTS', () => {
			const sut = createService({ step: OnboardingStep.MY_ARTISTS })
			expect(sut.isOnboarding).toBe(true)
		})

		it('should return false for COMPLETED', () => {
			const sut = createService({ step: OnboardingStep.COMPLETED })
			expect(sut.isOnboarding).toBe(false)
		})

		it('should return false for LP', () => {
			const sut = createService()
			expect(sut.isOnboarding).toBe(false)
		})
	})

	describe('isCompleted', () => {
		it('should return true for COMPLETED', () => {
			const sut = createService({ step: OnboardingStep.COMPLETED })
			expect(sut.isCompleted).toBe(true)
		})

		it('should return false for LP', () => {
			const sut = createService()
			expect(sut.isCompleted).toBe(false)
		})

		it('should return false for DASHBOARD', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.isCompleted).toBe(false)
		})
	})

	describe('setStep', () => {
		it('should update step to the given value', () => {
			const sut = createService()

			sut.setStep(OnboardingStep.DASHBOARD)

			expect(sut.step).toBe(OnboardingStep.DASHBOARD)
			expect(sut.currentStep).toBe(OnboardingStep.DASHBOARD)
		})
	})

	describe('complete', () => {
		it('should set step to COMPLETED', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })

			sut.complete()

			expect(sut.step).toBe(OnboardingStep.COMPLETED)
			expect(sut.isCompleted).toBe(true)
		})

		it('should deactivate spotlight', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })
			sut.activateSpotlight('[data-target]', 'msg')

			sut.complete()

			expect(sut.spotlightActive).toBe(false)
			expect(sut.spotlightTarget).toBe('')
			expect(sut.spotlightMessage).toBe('')
		})
	})

	describe('reset', () => {
		it('should set step to LP', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })

			sut.reset()

			expect(sut.step).toBe(OnboardingStep.LP)
		})
	})

	describe('activateSpotlight', () => {
		it('should set spotlight properties', () => {
			const sut = createService()

			sut.activateSpotlight('[data-hype-header]', 'Test message')

			expect(sut.spotlightActive).toBe(true)
			expect(sut.spotlightTarget).toBe('[data-hype-header]')
			expect(sut.spotlightMessage).toBe('Test message')
			expect(sut.spotlightRadius).toBe('12px')
		})

		it('should accept custom radius', () => {
			const sut = createService()

			sut.activateSpotlight('[data-target]', 'msg', undefined, '50%')

			expect(sut.spotlightRadius).toBe('50%')
		})

		it('should store onTap callback', () => {
			const sut = createService()
			const tapFn = (): void => {}

			sut.activateSpotlight('[data-target]', 'msg', tapFn)

			expect(sut.onSpotlightTap).toBe(tapFn)
		})
	})

	describe('deactivateSpotlight', () => {
		it('should clear all spotlight properties', () => {
			const sut = createService()
			sut.activateSpotlight('[data-target]', 'msg', () => {}, '24px')

			sut.deactivateSpotlight()

			expect(sut.spotlightActive).toBe(false)
			expect(sut.spotlightTarget).toBe('')
			expect(sut.spotlightMessage).toBe('')
			expect(sut.spotlightRadius).toBe('12px')
			expect(sut.onSpotlightTap).toBeUndefined()
		})
	})

	describe('bringSpotlightToFront', () => {
		it('should invoke onBringToFront callback when set', () => {
			const sut = createService()
			const bringFn = vi.fn()
			sut.onBringToFront = bringFn

			sut.bringSpotlightToFront()

			expect(bringFn).toHaveBeenCalledOnce()
		})

		it('should be a no-op when callback is not set', () => {
			const sut = createService()

			// Should not throw
			expect(() => sut.bringSpotlightToFront()).not.toThrow()
		})
	})

	describe('getRouteForCurrentStep', () => {
		it('should return "discovery" for DISCOVERY step', () => {
			const sut = createService({ step: OnboardingStep.DISCOVERY })
			expect(sut.getRouteForCurrentStep()).toBe('discovery')
		})

		it('should return "dashboard" for DASHBOARD step', () => {
			const sut = createService({ step: OnboardingStep.DASHBOARD })
			expect(sut.getRouteForCurrentStep()).toBe('dashboard')
		})

		it('should return "my-artists" for MY_ARTISTS step', () => {
			const sut = createService({ step: OnboardingStep.MY_ARTISTS })
			expect(sut.getRouteForCurrentStep()).toBe('my-artists')
		})

		it('should return empty string for LP', () => {
			const sut = createService()
			expect(sut.getRouteForCurrentStep()).toBe('')
		})

		it('should return empty string for COMPLETED', () => {
			const sut = createService({ step: OnboardingStep.COMPLETED })
			expect(sut.getRouteForCurrentStep()).toBe('')
		})
	})
})
