import { StorageKeys } from '../../constants/storage-keys'

const HELP_SEEN_PREFIX = 'onboarding.helpSeen:'

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

/** Remove every `onboarding.helpSeen:<page>` flag. */
export function clearAllHelpSeen(): void {
	const keys: string[] = []
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i)
		if (key?.startsWith(HELP_SEEN_PREFIX)) keys.push(key)
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
