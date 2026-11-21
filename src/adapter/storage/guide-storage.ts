/**
 * What the guide moments remember on this device: which moments a fan has
 * seen, and whether the fan has ever switched Discovery's view. Neither is
 * cleared at sign-up, sign-in or the reset of a guest's local data (guide-moment
 * "Each guide moment is shown once per device and survives sign-up"), so the
 * keys sit outside the `onboarding.*` prefixes that `clearOnboardingSeenFlags()`
 * removes.
 *
 * A storage that cannot be read or written (a private window, blocked site
 * data) keeps nothing: every moment counts as unseen and may show again.
 */

const SEEN_PREFIX = 'guide.seen:'
const VIEW_SWAPPED_KEY = 'guide.discoveryViewSwapped'

export function loadGuideSeen(id: string): boolean {
	try {
		return localStorage.getItem(SEEN_PREFIX + id) !== null
	} catch {
		return false
	}
}

export function saveGuideSeen(id: string): void {
	try {
		localStorage.setItem(SEEN_PREFIX + id, '1')
	} catch {
		// Nothing to keep on this device.
	}
}

/** Whether the fan has ever switched Discovery's view on this device. */
export function loadDiscoveryViewSwapped(): boolean {
	try {
		return localStorage.getItem(VIEW_SWAPPED_KEY) !== null
	} catch {
		return false
	}
}

export function saveDiscoveryViewSwapped(): void {
	try {
		localStorage.setItem(VIEW_SWAPPED_KEY, '1')
	} catch {
		// Nothing to keep on this device.
	}
}
