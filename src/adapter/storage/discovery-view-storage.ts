import { StorageKeys } from '../../constants/storage-keys'

/** The two views of Discovery: the artist bubbles and the All Nearby view. */
export type DiscoveryView = 'artists' | 'nearby'

/**
 * The Discovery view the fan used last on this device. Anything but an explicit
 * `'nearby'` — an absent key, an unknown value, or a storage that cannot be
 * read (a private window, blocked site data) — yields the artist bubbles.
 */
export function loadDiscoveryView(): DiscoveryView {
	try {
		return localStorage.getItem(StorageKeys.discoveryView) === 'nearby'
			? 'nearby'
			: 'artists'
	} catch {
		return 'artists'
	}
}

/**
 * Remember the Discovery view for the next visit. A storage that cannot be
 * written keeps nothing, and the next visit opens on the artist bubbles.
 */
export function saveDiscoveryView(view: DiscoveryView): void {
	try {
		localStorage.setItem(StorageKeys.discoveryView, view)
	} catch {
		// Nothing to keep on this device.
	}
}
