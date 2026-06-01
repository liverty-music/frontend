import { DI } from 'aurelia'

export interface ILocalStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
	/**
	 * Remove every key whose name starts with `prefix`. Used to clear all
	 * per-account namespaced entries (e.g. the guest-merge receipts) on sign-out
	 * without knowing the exact account id — the signed-out user's id is already
	 * cleared from the in-memory + cached state by the time SignedOut fires.
	 */
	removeByPrefix(prefix: string): void
}

/**
 * `window.localStorage` does not expose `removeByPrefix`, so wrap it in a thin
 * adapter that implements the enumeration-based bulk removal on top of the
 * native getItem/setItem/removeItem/key/length API.
 */
class LocalStorageAdapter implements ILocalStorage {
	constructor(private readonly store: Storage) {}

	public getItem(key: string): string | null {
		return this.store.getItem(key)
	}

	public setItem(key: string, value: string): void {
		this.store.setItem(key, value)
	}

	public removeItem(key: string): void {
		this.store.removeItem(key)
	}

	public removeByPrefix(prefix: string): void {
		// Collect first, delete after: removing while iterating by index shifts
		// the remaining keys and would skip entries.
		const toRemove: string[] = []
		for (let i = 0; i < this.store.length; i++) {
			const key = this.store.key(i)
			if (key?.startsWith(prefix)) toRemove.push(key)
		}
		for (const key of toRemove) this.store.removeItem(key)
	}
}

export const ILocalStorage = DI.createInterface<ILocalStorage>(
	'ILocalStorage',
	(x) => x.instance(new LocalStorageAdapter(window.localStorage)),
)
