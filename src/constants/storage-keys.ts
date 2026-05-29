export const StorageKeys = {
	uiNotificationPromptDismissed: 'ui.notificationPromptDismissed',
	uiSessionCount: 'ui.sessionCount',
	uiOnboardingCompletedSessionCount: 'ui.onboardingCompletedSessionCount',
	pwaInstalled: 'pwa.installed',
	postSignupShown: 'liverty:postSignup:shown',
	// Discovery bubble sound-effect preferences. '1'/'0' for mute, '0'..'1' for volume.
	soundMuted: 'liverty:sound:muted',
	soundVolume: 'liverty:sound:volume',
	// Anonymous-period UI language. See UserHydrationTask for cleanup.
	language: 'language',
} as const

/**
 * Keys stored in `sessionStorage` rather than `localStorage` — these are
 * scoped to the current browser tab and cleared on tab close. Per-tab
 * scoping is intentional: cross-tab coordination is not needed for these
 * flags, and the looser bound (one event per tab per session) is the
 * desired behavior.
 */
export const SessionKeys = {
	// Set after the first successful backfill of users.preferred_language
	// in the current tab. Prevents the hydration task from firing the
	// backfill RPC on every cold start when the network is flaky. A second
	// tab opened in the same session will re-attempt once per its own
	// lifetime — acceptable since the RPC is idempotent on a non-NULL row
	// (server returns the existing value unchanged).
	languageBackfillAttempted: 'liverty:lang:backfillAttempted',
} as const

// Per-external_id namespaced key holding the internal user_id resolved from
// UserService.Create or Get. Read by UserServiceClient before issuing any
// authenticated per-user RPC so the rpc-auth-scoping convention can be
// satisfied without an extra Get round-trip.
export function userIdStorageKey(externalID: string): string {
	return `liverty:userId:${externalID}`
}

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
	localStorage.removeItem('pwa.installPromptDismissed')
	// Migrate pwa.completedSessionCount to ui.onboardingCompletedSessionCount
	// before deleting — returning users have no other path to set the new key
	// (persistOnboardingCompletedSessionCount only fires on isCompleted transitions).
	const oldCompleted = localStorage.getItem('pwa.completedSessionCount')
	if (
		oldCompleted !== null &&
		localStorage.getItem('ui.onboardingCompletedSessionCount') === null
	) {
		localStorage.setItem('ui.onboardingCompletedSessionCount', oldCompleted)
	}
	localStorage.removeItem('pwa.completedSessionCount')
}

/**
 * Increment the per-session UI counter.
 * Call once at app startup (before any prompt components attach).
 */
export function trackSessionForPrompts(): void {
	const count =
		Number(localStorage.getItem(StorageKeys.uiSessionCount) || '0') + 1
	localStorage.setItem(StorageKeys.uiSessionCount, String(count))
}

/**
 * Persist the session index at which onboarding completed, the first time it happens.
 * Call once when onboarding transitions to COMPLETED — does NOT increment the session counter.
 */
export function persistOnboardingCompletedSessionCount(): void {
	if (
		localStorage.getItem(StorageKeys.uiOnboardingCompletedSessionCount) !== null
	)
		return
	const count = Number(localStorage.getItem(StorageKeys.uiSessionCount) || '0')
	localStorage.setItem(
		StorageKeys.uiOnboardingCompletedSessionCount,
		String(count),
	)
}
