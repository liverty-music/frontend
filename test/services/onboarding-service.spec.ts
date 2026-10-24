import { DI, ILogger, Registration } from 'aurelia'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	IOnboardingService,
	type OnboardingService,
} from '../../src/services/onboarding-service'
import { createMockLogger } from '../helpers/mock-logger'

const KEY_COMPLETE = 'onboardingComplete'

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
		// @spec stories/complete-onboarding "Brand-new user defaults to onboarding"
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

		// @spec stories/complete-onboarding "Completion is one-way"
		it('is idempotent and never reverts', () => {
			const sut = createService()
			sut.finish()
			sut.finish()
			expect(sut.isCompleted).toBe(true)
		})
	})
})
