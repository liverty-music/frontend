import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { IndexedDbWalletStorage } from '../../../src/adapter/storage/wallet-storage'

/** Open the wallet database as version 1 left it, with one record per store. */
async function seedVersion1(factory: IDBFactory): Promise<void> {
	const req = factory.open('wallet', 1)
	req.onupgradeneeded = () => {
		req.result.createObjectStore('device-key')
		req.result.createObjectStore('ticket-snapshot')
	}
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
	const tx = db.transaction(['device-key', 'ticket-snapshot'], 'readwrite')
	tx.objectStore('device-key').put(
		{ keyPair: null, lastCheck: 'entry' },
		'current',
	)
	tx.objectStore('ticket-snapshot').put({ groups: ['saved'] }, 'current')
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
	})
	db.close()
}

describe('IndexedDbWalletStorage', () => {
	it('keeps the key and the saved list when a version 1 database is upgraded', async () => {
		const factory = new IDBFactory()
		await seedVersion1(factory)
		const storage = new IndexedDbWalletStorage(factory)

		expect(await storage.getDeviceKey()).toEqual({
			keyPair: null,
			lastCheck: 'entry',
		})
		expect(await storage.getSnapshot()).toEqual({ groups: ['saved'] })
		expect(await storage.getStampedIds()).toEqual(new Set())
	})

	it('reads back the stamped ids on a later visit', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Opened again"
		const factory = new IDBFactory()
		await new IndexedDbWalletStorage(factory).addStampedIds(['t-1', 't-2'])
		await new IndexedDbWalletStorage(factory).addStampedIds(['t-2', 't-3'])

		const later = new IndexedDbWalletStorage(factory)
		expect(await later.getStampedIds()).toEqual(new Set(['t-1', 't-2', 't-3']))
	})

	it('forgets the stamped ids with the rest of the wallet on sign-out', async () => {
		// @spec components/infrastructure/fan/web/route/tickets "Signed out and in again"
		const factory = new IDBFactory()
		const storage = new IndexedDbWalletStorage(factory)
		await storage.putSnapshot({ groups: [] })
		await storage.addStampedIds(['t-1'])

		await storage.clear()

		const later = new IndexedDbWalletStorage(factory)
		expect(await later.getStampedIds()).toEqual(new Set())
		expect(await later.getSnapshot()).toBeUndefined()
	})

	it('rejects when IndexedDB is unavailable', async () => {
		const storage = new IndexedDbWalletStorage(undefined)
		await expect(storage.getStampedIds()).rejects.toThrow()
	})
})
