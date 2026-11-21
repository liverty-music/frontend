import { beforeEach, describe, expect, it } from 'vitest'
import {
	clearOnboardingSeenFlags,
	loadHypeSnackSeen,
	loadOnboardingComplete,
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

	describe('hype snack flags', () => {
		it('records and reads a flag per level', () => {
			expect(loadHypeSnackSeen('away')).toBe(false)
			saveHypeSnackSeen('away')
			expect(loadHypeSnackSeen('away')).toBe(true)
			expect(loadHypeSnackSeen('home')).toBe(false)
			expect(localStorage.getItem('onboarding.hypeSnackSeen:away')).toBe('1')
		})

		// @spec components/infrastructure/fan/web/global/page-help "Help-seen flags cleared on fresh onboarding"
		it('clears the hype snack flags and nothing else', () => {
			saveHypeSnackSeen('away')
			saveHypeSnackSeen('watch')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guide.seen:discovery.follow', '1')

			clearOnboardingSeenFlags()

			expect(loadHypeSnackSeen('away')).toBe(false)
			expect(loadHypeSnackSeen('watch')).toBe(false)
			expect(localStorage.getItem('onboarding.celebrationShown')).toBe('1')
			// The seen guide moments survive sign-up and sign-in.
			expect(localStorage.getItem('guide.seen:discovery.follow')).toBe('1')
		})
	})
})
