import type {
	DeviceKeyRecord,
	IWalletStorage,
} from '../../src/adapter/storage/wallet-storage'

/**
 * In-memory IWalletStorage that keeps objects as IndexedDB would hand them
 * back (structured clones), so CryptoKeys and Dates survive like on a device.
 * Share one instance between two route instances to model a later visit.
 */
export class FakeWalletStorage implements IWalletStorage {
	public deviceKey: DeviceKeyRecord | undefined
	public snapshot: unknown
	public stampedIds = new Set<string>()

	public async getDeviceKey(): Promise<DeviceKeyRecord | undefined> {
		return this.deviceKey ? structuredClone(this.deviceKey) : undefined
	}

	public async putDeviceKey(record: DeviceKeyRecord): Promise<void> {
		this.deviceKey = structuredClone(record)
	}

	public async getSnapshot<T>(): Promise<T | undefined> {
		return this.snapshot === undefined
			? undefined
			: (structuredClone(this.snapshot) as T)
	}

	public async putSnapshot<T>(snapshot: T): Promise<void> {
		this.snapshot = structuredClone(snapshot)
	}

	public async getStampedIds(): Promise<ReadonlySet<string>> {
		return new Set(this.stampedIds)
	}

	public async addStampedIds(ids: readonly string[]): Promise<void> {
		for (const id of ids) this.stampedIds.add(id)
	}

	public async clear(): Promise<void> {
		this.deviceKey = undefined
		this.snapshot = undefined
		this.stampedIds.clear()
	}
}
