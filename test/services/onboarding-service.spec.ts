import { DI, ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	IOnboardingService,
	type OnboardingService,
} from '../../src/services/onboarding-service'
import { createMockLogger } from '../helpers/mock-logger'

const KEY_COMPLETE = 'onboardingComplete'
const KEY_LEGACY_STEP = 'onboardingStep'

function createService(): OnboardingService {
	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(IOnboardingService)
	return container.get(IOnboardingService)
}

describe('OnboardingService', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	describe('default state', () => {
		it('defaults a brand-new user to onboarding', () => {
			const sut = createService()
			expect(sut.isOnboarding).toBe(true)
			expect(sut.isCompleted).toBe(false)
		})

		it('hydrates a completed flag from localStorage', () => {
			localStorage.setItem(KEY_COMPLETE, 'true')
			const sut = createService()
			expect(sut.isOnboarding).toBe(false)
			expect(sut.isCompleted).toBe(true)
		})
	})

	describe('finish (one-way latch)', () => {
		it('flips isOnboarding to false and persists', () => {
			const sut = createService()

			sut.finish()

			expect(sut.isOnboarding).toBe(false)
			expect(sut.isCompleted).toBe(true)
			expect(localStorage.getItem(KEY_COMPLETE)).toBe('true')
		})

		it('is idempotent and never reverts', () => {
			const sut = createService()
			sut.finish()
			sut.finish()
			expect(sut.isCompleted).toBe(true)
		})
	})

	describe('legacy onboardingStep migration', () => {
		it.each([
			'completed',
			'7',
		])('migrates completed marker %s to completed (isOnboarding=false)', (legacy) => {
			localStorage.setItem(KEY_LEGACY_STEP, legacy)

			const sut = createService()

			expect(sut.isCompleted).toBe(true)
			expect(sut.isOnboarding).toBe(false)
			expect(localStorage.getItem(KEY_COMPLETE)).toBe('true')
			expect(localStorage.getItem(KEY_LEGACY_STEP)).toBeNull()
		})

		it.each([
			'discovery',
			'my-artists',
			'detail',
			'lp',
			'dashboard',
		])('migrates non-completed value %s to still-onboarding (isOnboarding=true)', (legacy) => {
			localStorage.setItem(KEY_LEGACY_STEP, legacy)

			const sut = createService()

			expect(sut.isOnboarding).toBe(true)
			expect(sut.isCompleted).toBe(false)
			expect(localStorage.getItem(KEY_COMPLETE)).toBe('false')
			expect(localStorage.getItem(KEY_LEGACY_STEP)).toBeNull()
		})

		it('runs at most once (legacy key deleted after migration)', () => {
			localStorage.setItem(KEY_LEGACY_STEP, 'completed')
			createService()
			expect(localStorage.getItem(KEY_LEGACY_STEP)).toBeNull()

			// A second construction sees no legacy key and reads the new flag.
			const sut2 = createService()
			expect(sut2.isCompleted).toBe(true)
		})
	})
})
