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
 * IndexedDB persistence for the ticket wallet: the device key pair and the last
 * loaded tickets list (shown again without a connection). Web Storage cannot
 * hold a `CryptoKey`, so both live here, in one database. Every method rejects
 * when IndexedDB is unavailable; callers treat that like an empty store.
 */
export interface IWalletStorage {
	getDeviceKey(): Promise<DeviceKeyRecord | undefined>
	putDeviceKey(record: DeviceKeyRecord): Promise<void>
	getSnapshot<T>(): Promise<T | undefined>
	putSnapshot<T>(snapshot: T): Promise<void>
	/** Remove the key pair and the saved list (sign-out). */
	clear(): Promise<void>
}

const DB_NAME = 'liverty-wallet'
const DB_VERSION = 1
const KEY_STORE = 'device-key'
const SNAPSHOT_STORE = 'ticket-snapshot'
/** Each store holds one record under this key. */
const RECORD_KEY = 'current'

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
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
			req.onupgradeneeded = () => {
				req.result.createObjectStore(KEY_STORE)
				req.result.createObjectStore(SNAPSHOT_STORE)
			}
			this.db = request(req).catch((err: unknown) => {
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

	public async clear(): Promise<void> {
		const db = await this.open()
		const tx = db.transaction([KEY_STORE, SNAPSHOT_STORE], 'readwrite')
		tx.objectStore(KEY_STORE).clear()
		tx.objectStore(SNAPSHOT_STORE).clear()
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(tx.error)
			tx.onabort = () => reject(tx.error)
		})
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
