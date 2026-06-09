import { beforeEach, describe, expect, it } from 'vitest'
import {
	clearAllHelpSeen,
	loadHelpSeen,
	loadOnboardingComplete,
	saveHelpSeen,
	saveOnboardingComplete,
} from '../../../src/adapter/storage/onboarding-storage'

const KEY_COMPLETE = 'onboardingComplete'
const KEY_LEGACY_STEP = 'onboardingStep'

describe('onboarding-storage', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	describe('onboarding-complete flag', () => {
		it('defaults to false when no key exists', () => {
			expect(loadOnboardingComplete()).toBe(false)
		})

		it('round-trips the persisted boolean', () => {
			saveOnboardingComplete(true)
			expect(localStorage.getItem(KEY_COMPLETE)).toBe('true')
			expect(loadOnboardingComplete()).toBe(true)

			saveOnboardingComplete(false)
			expect(loadOnboardingComplete()).toBe(false)
		})

		it('migrates a completed legacy step and deletes the legacy key', () => {
			localStorage.setItem(KEY_LEGACY_STEP, 'completed')
			expect(loadOnboardingComplete()).toBe(true)
			expect(localStorage.getItem(KEY_LEGACY_STEP)).toBeNull()
			expect(localStorage.getItem(KEY_COMPLETE)).toBe('true')
		})

		it('migrates a non-completed legacy step to false', () => {
			localStorage.setItem(KEY_LEGACY_STEP, 'discovery')
			expect(loadOnboardingComplete()).toBe(false)
			expect(localStorage.getItem(KEY_LEGACY_STEP)).toBeNull()
			expect(localStorage.getItem(KEY_COMPLETE)).toBe('false')
		})
	})

	describe('help-seen helpers', () => {
		it('records and reads per-page help-seen flags', () => {
			expect(loadHelpSeen('dashboard')).toBe(false)
			saveHelpSeen('dashboard')
			expect(loadHelpSeen('dashboard')).toBe(true)
		})

		it('clears all known per-page help-seen flags', () => {
			saveHelpSeen('discovery')
			saveHelpSeen('dashboard')
			saveHelpSeen('my-artists')

			clearAllHelpSeen()

			expect(loadHelpSeen('discovery')).toBe(false)
			expect(loadHelpSeen('dashboard')).toBe(false)
			expect(loadHelpSeen('my-artists')).toBe(false)
		})
	})
})
