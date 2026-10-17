import { StorageKeys } from '../../constants/storage-keys'

/**
 * FAB action-launcher handedness. The FAB stays in the navigation bar's centre
 * notch either way; `'right'` (default) opens the action arc up and to the
 * right, `'left'` mirrors it to the left for left-handed one-handed reach.
 */
export type Handedness = 'right' | 'left'

/**
 * Load the persisted FAB handedness. Any value other than the explicit `'left'`
 * (including an absent key) resolves to the `'right'` default, so a first-time
 * or corrupted value never leaves the arc without a side.
 */
export function loadHanded(): Handedness {
	return localStorage.getItem(StorageKeys.fabHanded) === 'left'
		? 'left'
		: 'right'
}

/** Persist the FAB handedness preference. */
export function saveHanded(handed: Handedness): void {
	localStorage.setItem(StorageKeys.fabHanded, handed)
}
