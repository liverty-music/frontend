import { beforeEach, describe, expect, it } from 'vitest'
import {
	clearOnboardingSeenFlags,
	loadHelpSeen,
	loadHypeSnackSeen,
	loadOnboardingComplete,
	saveHelpSeen,
	saveHypeSnackSeen,
	saveOnboardingComplete,
} from '../../../src/adapter/storage/onboarding-storage'

const KEY_COMPLETE = 'onboardingComplete'

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
	})

	describe('help-seen helpers', () => {
		it('records and reads per-page help-seen flags', () => {
			expect(loadHelpSeen('dashboard')).toBe(false)
			saveHelpSeen('dashboard')
			expect(loadHelpSeen('dashboard')).toBe(true)
		})

		it('clears every onboarding.helpSeen:* key and nothing else', () => {
			localStorage.setItem('onboarding.helpSeen:tickets', '1')
			localStorage.setItem('onboarding.celebrationShown', '1')
			saveHelpSeen('discovery')

			clearOnboardingSeenFlags()

			expect(localStorage.getItem('onboarding.helpSeen:tickets')).toBeNull()
			expect(localStorage.getItem('onboarding.helpSeen:discovery')).toBeNull()
			expect(localStorage.getItem('onboarding.celebrationShown')).toBe('1')
		})

		it('keeps each flag under onboarding.helpSeen:<page>', () => {
			saveHelpSeen('discovery')
			expect(localStorage.getItem('onboarding.helpSeen:discovery')).toBe('1')
		})

		it('clears all known per-page help-seen flags', () => {
			saveHelpSeen('discovery')
			saveHelpSeen('dashboard')
			saveHelpSeen('my-artists')

			clearOnboardingSeenFlags()

			expect(loadHelpSeen('discovery')).toBe(false)
			expect(loadHelpSeen('dashboard')).toBe(false)
			expect(loadHelpSeen('my-artists')).toBe(false)
		})
	})

	describe('hype snack flags', () => {
		it('records and reads a flag per level', () => {
			expect(loadHypeSnackSeen('away')).toBe(false)
			saveHypeSnackSeen('away')
			expect(loadHypeSnackSeen('away')).toBe(true)
			expect(loadHypeSnackSeen('home')).toBe(false)
			expect(localStorage.getItem('onboarding.hypeSnackSeen:away')).toBe('1')
		})

		it('clears the hype snack flags with the help-seen flags', () => {
			saveHypeSnackSeen('away')
			saveHypeSnackSeen('watch')
			saveHelpSeen('my-artists')
			localStorage.setItem('onboarding.celebrationShown', '1')

			clearOnboardingSeenFlags()

			expect(loadHypeSnackSeen('away')).toBe(false)
			expect(loadHypeSnackSeen('watch')).toBe(false)
			expect(loadHelpSeen('my-artists')).toBe(false)
			expect(localStorage.getItem('onboarding.celebrationShown')).toBe('1')
		})
	})
})
