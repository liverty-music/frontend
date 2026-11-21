import { StorageKeys } from '../../constants/storage-keys'
import type { Hype } from '../../entities/follow'

const HYPE_SNACK_SEEN_PREFIX = 'onboarding.hypeSnackSeen:'

export function saveOnboardingComplete(complete: boolean): void {
	localStorage.setItem(
		StorageKeys.onboardingComplete,
		complete ? 'true' : 'false',
	)
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
 * Remove every `onboarding.hypeSnackSeen:<level>` flag, so each hype snack
 * shows again. The seen guide moments (`guide.seen:*`, guide-storage) are
 * kept: they survive sign-up and sign-in. The retired
 * `onboarding.helpSeen:<page>` flags are no longer read and are left alone.
 */
export function clearOnboardingSeenFlags(): void {
	const keys: string[] = []
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)
		if (key?.startsWith(HYPE_SNACK_SEEN_PREFIX)) keys.push(key)
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
