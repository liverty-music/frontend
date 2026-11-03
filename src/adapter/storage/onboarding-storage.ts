import { StorageKeys } from '../../constants/storage-keys'
import type { Hype } from '../../entities/follow'

const HELP_SEEN_PREFIX = 'onboarding.helpSeen:'
const HYPE_SNACK_SEEN_PREFIX = 'onboarding.hypeSnackSeen:'

export function saveOnboardingComplete(complete: boolean): void {
	localStorage.setItem(
		StorageKeys.onboardingComplete,
		complete ? 'true' : 'false',
	)
}

export function saveHelpSeen(page: string): void {
	localStorage.setItem(HELP_SEEN_PREFIX + page, '1')
}

export function loadHelpSeen(page: string): boolean {
	return localStorage.getItem(HELP_SEEN_PREFIX + page) !== null
}

/**
 * Record that My Artists showed the hype snack for `hype` on this device, so
 * a later pick of the same level shows none (while push is on, and for a
 * guest).
 */
export function saveHypeSnackSeen(hype: Hype): void {
	localStorage.setItem(HYPE_SNACK_SEEN_PREFIX + hype, '1')
}

export function loadHypeSnackSeen(hype: Hype): boolean {
	return localStorage.getItem(HYPE_SNACK_SEEN_PREFIX + hype) !== null
}

/**
 * Remove every `onboarding.helpSeen:<page>` and `onboarding.hypeSnackSeen:<level>`
 * flag, so page help opens and each hype snack shows again.
 */
export function clearOnboardingSeenFlags(): void {
	const keys: string[] = []
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)
		if (
			key?.startsWith(HELP_SEEN_PREFIX) ||
			key?.startsWith(HYPE_SNACK_SEEN_PREFIX)
		) {
			keys.push(key)
		}
	}
	for (const key of keys) localStorage.removeItem(key)
}

/**
 * Load the persisted onboarding-complete flag. Absent key → `false`, i.e. a
 * brand-new user defaults to still onboarding.
 */
export function loadOnboardingComplete(): boolean {
	return localStorage.getItem(StorageKeys.onboardingComplete) === 'true'
}
