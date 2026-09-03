import { StorageKeys } from '../../constants/storage-keys'

/**
 * FAB action-launcher placement preference. `'right'` (default) puts the FAB in
 * the bottom-right corner; `'left'` mirrors it to the bottom-left for
 * left-handed one-handed reach.
 */
export type Handedness = 'right' | 'left'

/**
 * Load the persisted FAB placement. Any value other than the explicit `'left'`
 * (including an absent key) resolves to the `'right'` default, so a first-time
 * or corrupted value never leaves the launcher unplaced.
 */
export function loadHanded(): Handedness {
	return localStorage.getItem(StorageKeys.fabHanded) === 'left'
		? 'left'
		: 'right'
}

/** Persist the FAB placement preference. */
export function saveHanded(handed: Handedness): void {
	localStorage.setItem(StorageKeys.fabHanded, handed)
}
