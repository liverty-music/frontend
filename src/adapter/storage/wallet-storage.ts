import { DI } from 'aurelia'

/**
 * This device's key pair for entry QR codes and whether it was the fan's
 * entry device at the last online check. The private key is a
 * non-extractable WebCrypto `CryptoKey`: IndexedDB keeps the key object itself
 * (structured clone), never its bytes, so page script cannot read it out.
 */
export interface DeviceKeyRecord {
	/** Null until this device first becomes, or is asked to become, the entry device. */
	readonly keyPair: CryptoKeyPair | null
	/**
	 * The last online check: `entry` when the fan's WalletPublicKey was this
	 * device's public key, `other` when it was another device's, `unchecked`
	 * before any completed check. Without a connection the QR code is offered
	 * only on `entry`.
	 */
	readonly lastCheck: EntryDeviceCheck
}

export type EntryDeviceCheck = 'entry' | 'other' | 'unchecked'

/**
 * IndexedDB persistence for the ticket wallet: the device key pair, the last
 * loaded tickets list (shown again without a connection) and the ids of the
 * tickets whose admission stamp this device has played. Web Storage cannot
 * hold a `CryptoKey`, so all three live here, in one database that sign-out
 * empties. Every method rejects when IndexedDB is unavailable; callers treat
 * that like an empty store.
 */
export interface IWalletStorage {
	getDeviceKey(): Promise<DeviceKeyRecord | undefined>
	putDeviceKey(record: DeviceKeyRecord): Promise<void>
	getSnapshot<T>(): Promise<T | undefined>
	putSnapshot<T>(snapshot: T): Promise<void>
	/** The ids of the tickets whose admission stamp this device has played. */
	getStampedIds(): Promise<ReadonlySet<string>>
	/** Record that the admission stamp of these tickets has been played. */
	addStampedIds(ids: readonly string[]): Promise<void>
	/** Remove the key pair, the saved list and the stamped ids (sign-out). */
	clear(): Promise<void>
}

const DB_NAME = 'wallet'
/**
 * 2 added `stamped-tickets`. A build with an older version cannot open the
 * upgraded database (`VersionError`), so the frontend is never rolled back
 * past this version.
 */
const DB_VERSION = 2
const KEY_STORE = 'device-key'
const SNAPSHOT_STORE = 'ticket-snapshot'
/** One record per stamped ticket, keyed by the ticket id. */
const STAMPED_STORE = 'stamped-tickets'
const ALL_STORES = [KEY_STORE, SNAPSHOT_STORE, STAMPED_STORE]
/** The key and snapshot stores hold one record under this key. */
const RECORD_KEY = 'current'

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

function complete(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
		tx.onabort = () => reject(tx.error)
	})
}

export class IndexedDbWalletStorage implements IWalletStorage {
	private db: Promise<IDBDatabase> | null = null

	constructor(private readonly factory: IDBFactory | undefined) {}

	private open(): Promise<IDBDatabase> {
		if (!this.db) {
			const factory = this.factory
			if (!factory) return Promise.reject(new Error('IndexedDB unavailable'))
			const req = factory.open(DB_NAME, DB_VERSION)
			// Create only the stores missing, so an upgrade from version 1
			// keeps the key pair and the saved list.
			req.onupgradeneeded = () => {
				const db = req.result
				for (const name of ALL_STORES) {
					if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
				}
			}
			this.db = new Promise<IDBDatabase>((resolve, reject) => {
				// Another tab still holds the database at an older version (an
				// old build left open across a deploy). The upgrade waits until
				// that tab closes, so fail now, like an unavailable IndexedDB,
				// rather than hold the screen on a request that may never end.
				let blocked = false
				req.onblocked = () => {
					blocked = true
					reject(new Error('IndexedDB upgrade blocked by another tab'))
				}
				req.onsuccess = () => {
					const db = req.result
					// Opened only after the rejection: the next call opens again.
					if (blocked) {
						db.close()
						return
					}
					// Let a later build's upgrade in another tab proceed.
					db.onversionchange = () => {
						db.close()
						this.db = null
					}
					resolve(db)
				}
				req.onerror = () => reject(req.error)
			}).catch((err: unknown) => {
				this.db = null
				throw err
			})
		}
		return this.db
	}

	private async get<T>(store: string): Promise<T | undefined> {
		const db = await this.open()
		return request<T | undefined>(
			db.transaction(store, 'readonly').objectStore(store).get(RECORD_KEY),
		)
	}

	private async put(store: string, value: unknown): Promise<void> {
		const db = await this.open()
		await request(
			db
				.transaction(store, 'readwrite')
				.objectStore(store)
				.put(value, RECORD_KEY),
		)
	}

	public getDeviceKey(): Promise<DeviceKeyRecord | undefined> {
		return this.get<DeviceKeyRecord>(KEY_STORE)
	}

	public putDeviceKey(record: DeviceKeyRecord): Promise<void> {
		return this.put(KEY_STORE, record)
	}

	public getSnapshot<T>(): Promise<T | undefined> {
		return this.get<T>(SNAPSHOT_STORE)
	}

	public putSnapshot<T>(snapshot: T): Promise<void> {
		return this.put(SNAPSHOT_STORE, snapshot)
	}

	public async getStampedIds(): Promise<ReadonlySet<string>> {
		const db = await this.open()
		const keys = await request(
			db
				.transaction(STAMPED_STORE, 'readonly')
				.objectStore(STAMPED_STORE)
				.getAllKeys(),
		)
		return new Set(keys.map(String))
	}

	public async addStampedIds(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return
		const db = await this.open()
		const tx = db.transaction(STAMPED_STORE, 'readwrite')
		const store = tx.objectStore(STAMPED_STORE)
		for (const id of ids) store.put(true, id)
		await complete(tx)
	}

	public async clear(): Promise<void> {
		const db = await this.open()
		const tx = db.transaction(ALL_STORES, 'readwrite')
		for (const name of ALL_STORES) tx.objectStore(name).clear()
		await complete(tx)
	}
}

export const IWalletStorage = DI.createInterface<IWalletStorage>(
	'IWalletStorage',
	(x) =>
		x.instance(
			new IndexedDbWalletStorage(
				typeof indexedDB === 'undefined' ? undefined : indexedDB,
			),
		),
)
