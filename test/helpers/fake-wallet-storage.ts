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

	public async clear(): Promise<void> {
		this.deviceKey = undefined
		this.snapshot = undefined
	}
}
