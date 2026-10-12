import { DI } from 'aurelia'

/**
 * IndexedDB persistence for the scanner device's key pairs, one per Scanner
 * (keyed by its link token). The private key is a
 * non-extractable WebCrypto `CryptoKey`: IndexedDB keeps the key object itself
 * (structured clone), never its bytes, so page script cannot read it out. Web
 * Storage cannot hold a `CryptoKey`, hence IndexedDB.
 *
 * Every method rejects when IndexedDB is unavailable; the caller then keeps
 * the key in memory for the page's lifetime only.
 */
export interface IScannerKeyStore {
	get(linkToken: string): Promise<CryptoKeyPair | undefined>
	put(linkToken: string, keyPair: CryptoKeyPair): Promise<void>
}

/**
 * Kept from before the Scanner rename (rename-reception-to-scanner, design
 * D5): renaming the database would orphan the key of every bound Scanner.
 */
const DB_NAME = 'liverty-reception'
const DB_VERSION = 1
const KEY_STORE = 'device-key'

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

export class IndexedDbScannerKeyStore implements IScannerKeyStore {
	private db: Promise<IDBDatabase> | null = null

	constructor(private readonly factory: IDBFactory | undefined) {}

	private open(): Promise<IDBDatabase> {
		if (!this.db) {
			const factory = this.factory
			if (!factory) return Promise.reject(new Error('IndexedDB unavailable'))
			const req = factory.open(DB_NAME, DB_VERSION)
			req.onupgradeneeded = () => {
				req.result.createObjectStore(KEY_STORE)
			}
			this.db = request(req).catch((err: unknown) => {
				this.db = null
				throw err
			})
		}
		return this.db
	}

	public async get(linkToken: string): Promise<CryptoKeyPair | undefined> {
		const db = await this.open()
		return request<CryptoKeyPair | undefined>(
			db
				.transaction(KEY_STORE, 'readonly')
				.objectStore(KEY_STORE)
				.get(linkToken),
		)
	}

	public async put(linkToken: string, keyPair: CryptoKeyPair): Promise<void> {
		const db = await this.open()
		await request(
			db
				.transaction(KEY_STORE, 'readwrite')
				.objectStore(KEY_STORE)
				.put(keyPair, linkToken),
		)
	}
}

export const IScannerKeyStore = DI.createInterface<IScannerKeyStore>(
	'IScannerKeyStore',
	(x) =>
		x.instance(
			new IndexedDbScannerKeyStore(
				typeof indexedDB === 'undefined' ? undefined : indexedDB,
			),
		),
)
