export const StorageKeys = {
	onboardingStep: 'onboardingStep',
	guestHome: 'guest.home',
	userNotificationsEnabled: 'user.notificationsEnabled',
	guestFollowedArtists: 'guest.followedArtists',
	guestKeyPrefix: 'guest.',
	uiNotificationPromptDismissed: 'ui.notificationPromptDismissed',
	pwaSessionCount: 'pwa.sessionCount',
	pwaInstallPromptDismissed: 'pwa.installPromptDismissed',
} as const

/**
 * Migrate legacy localStorage keys from the old admin area format.
 * Removes `user.adminArea` (now stored server-side via User.home)
 * and renames `guest.adminArea` to `guest.home`.
 * Safe to call multiple times.
 */
export function migrateStorageKeys(): void {
	// Migrate guest.adminArea → guest.home
	const oldGuestArea = localStorage.getItem('guest.adminArea')
	if (oldGuestArea !== null) {
		localStorage.setItem(StorageKeys.guestHome, oldGuestArea)
		localStorage.removeItem('guest.adminArea')
	}
	// Remove deprecated user.adminArea (now managed server-side)
	localStorage.removeItem('user.adminArea')
}
