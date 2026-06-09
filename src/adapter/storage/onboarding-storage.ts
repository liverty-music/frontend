import { StorageKeys } from '../../constants/storage-keys'
import { LEGACY_COMPLETED_STEPS } from '../../entities/onboarding'

/** Legacy step-machine key, migrated once then deleted. */
const KEY_LEGACY_STEP = 'onboardingStep'
const HELP_SEEN_PREFIX = 'liverty:onboarding:helpSeen:'

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

export function clearAllHelpSeen(): void {
	for (const page of ['discovery', 'dashboard', 'my-artists']) {
		localStorage.removeItem(HELP_SEEN_PREFIX + page)
	}
}

/**
 * Load the persisted onboarding-complete flag, running a one-time, lossless
 * migration off the legacy `onboardingStep` key.
 *
 * Migration: if the legacy key exists, the new flag is set to whether the legacy
 * value denotes completion (member of `LEGACY_COMPLETED_STEPS` — `'completed'`
 * or the legacy numeric `'7'`); any other value (`'discovery'`, `'my-artists'`,
 * `'detail'`, absent) maps to `false`. The new value is persisted and the legacy
 * key is deleted, so the migration runs at most once per client.
 *
 * Absent new key (and no legacy key) → `false`, i.e. a brand-new user defaults
 * to still onboarding.
 */
export function loadOnboardingComplete(): boolean {
	const legacy = localStorage.getItem(KEY_LEGACY_STEP)
	if (legacy !== null) {
		const complete = LEGACY_COMPLETED_STEPS.has(legacy)
		saveOnboardingComplete(complete)
		localStorage.removeItem(KEY_LEGACY_STEP)
		return complete
	}
	return localStorage.getItem(StorageKeys.onboardingComplete) === 'true'
}
