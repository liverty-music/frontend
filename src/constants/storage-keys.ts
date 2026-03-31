export const StorageKeys = {
	userNotificationsEnabled: 'user.notificationsEnabled',
	uiNotificationPromptDismissed: 'ui.notificationPromptDismissed',
	uiSessionCount: 'ui.sessionCount',
	uiOnboardingCompletedSessionCount: 'ui.onboardingCompletedSessionCount',
	pwaInstalled: 'pwa.installed',
	celebrationShown: 'onboarding.celebrationShown',
	postSignupShown: 'liverty:postSignup:shown',
} as const

/**
 * Migrate legacy localStorage keys from the old admin area format.
 * Removes `user.adminArea` (now stored server-side via User.home)
 * and renames `guest.adminArea` to `guest.home`.
 * Safe to call multiple times.
 */
export function migrateStorageKeys(): void {
	// Remove legacy guest.adminArea — old values were Japanese text (e.g. "東京")
	// which cannot be reverse-mapped to ISO 3166-2 codes. Users must re-select.
	localStorage.removeItem('guest.adminArea')
	// Remove deprecated user.adminArea (now managed server-side)
	localStorage.removeItem('user.adminArea')
	// Remove deprecated PWA session-count keys (replaced by ui.sessionCount)
	localStorage.removeItem('pwa.sessionCount')
	localStorage.removeItem('pwa.completedSessionCount')
	localStorage.removeItem('pwa.installPromptDismissed')
}

/**
 * Increment the per-session UI counter and persist the onboarding-completion
 * session index the first time onboarding finishes.
 * Call once at app startup (before any prompt components attach).
 */
export function trackSessionForPrompts(onboardingCompleted: boolean): void {
	const count =
		Number(localStorage.getItem(StorageKeys.uiSessionCount) || '0') + 1
	localStorage.setItem(StorageKeys.uiSessionCount, String(count))

	if (
		onboardingCompleted &&
		localStorage.getItem(StorageKeys.uiOnboardingCompletedSessionCount) === null
	) {
		localStorage.setItem(
			StorageKeys.uiOnboardingCompletedSessionCount,
			String(count),
		)
	}
}
