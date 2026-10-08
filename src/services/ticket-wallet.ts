import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import {
	type AdmissionCodeContent,
	signAdmissionCode,
} from '../../shared/lib/admission-code/admission-code'
import { IWalletPublicKeyRpcClient } from '../adapter/rpc/client/wallet-public-key-client'
import {
	type DeviceKeyRecord,
	IWalletStorage,
} from '../adapter/storage/wallet-storage'
import { SignedOut } from './events/signed-out'

export const ITicketWallet = DI.createInterface<ITicketWallet>(
	'ITicketWallet',
	(x) => x.singleton(TicketWallet),
)

export interface ITicketWallet extends TicketWallet {}

/** The device key pair: ECDSA over P-256, as WalletPublicKey requires. */
const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }

/**
 * How this device stands for showing entry QR codes:
 * - `ready`: it is the fan's entry device; codes can be made offline.
 * - `other-device`: the fan's entry device is another device; no QR code
 *   here unless the fan chooses to use this device.
 * - `needs-connection`: offline, and never confirmed as the entry device.
 * - `failed`: online, but the check or the registration failed before this
 *   device was ever checked.
 */
export type DeviceReadiness =
	| 'ready'
	| 'other-device'
	| 'needs-connection'
	| 'failed'

export interface DeviceCheck {
	readonly readiness: DeviceReadiness
	/** True when registering moved the fan's key here from another device. */
	readonly replacedOtherKey: boolean
	/** True when a registration was attempted and failed. */
	readonly failed?: boolean
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * The fan's ticket wallet on this device: the device key pair that signs
 * entry QR codes, whether this device is the fan's entry device, and the last
 * loaded tickets list for use without a connection.
 *
 * The entry device is the one whose public key is the fan's WalletPublicKey.
 * It is chosen once (the first online visit when the fan has none) and moves
 * only when the fan asks ({@link useThisDevice}); revisits and reloads only
 * read the fan's key and compare it, registering nothing.
 *
 * The private key is created non-extractable and kept as a `CryptoKey` in
 * IndexedDB; it is only ever handed to `crypto.subtle.sign`. Only the public
 * key is sent. Everything is removed on sign-out, so the next person on a
 * shared browser starts clean.
 */
export class TicketWallet {
	private readonly logger = resolve(ILogger).scopeTo('TicketWallet')
	private readonly storage = resolve(IWalletStorage)
	private readonly keyClient = resolve(IWalletPublicKeyRpcClient)
	private readonly ea = resolve(IEventAggregator)

	/** Last known record; also the fallback when IndexedDB is unavailable. */
	private record: DeviceKeyRecord | undefined

	constructor() {
		this.ea.subscribe(SignedOut, () => void this.clear())
	}

	/**
	 * Find out whether this device is the fan's entry device. Online, it reads
	 * the fan's WalletPublicKey and compares it with this device's key; it
	 * registers only when the fan has no key at all. Offline, it reports the
	 * result of the last online check. Never throws.
	 */
	public async checkDevice(
		online: boolean,
		signal?: AbortSignal,
	): Promise<DeviceCheck> {
		const record = await this.loadRecord()
		if (!online) {
			return { readiness: offlineReadiness(record), replacedOtherKey: false }
		}

		let fanKey: Uint8Array | null
		try {
			fanKey = await this.keyClient.get(signal)
		} catch (err) {
			this.logger.warn('Reading the entry device failed', { error: err })
			// The last online check still tells whether codes from here count.
			return { readiness: fallbackReadiness(record), replacedOtherKey: false }
		}

		if (fanKey === null) {
			// No entry device yet: this one becomes it, without asking.
			return this.register(signal)
		}

		const keyPair = record?.keyPair ?? null
		const isThisDevice =
			keyPair !== null && sameBytes(fanKey, await exportRaw(keyPair))
		await this.saveRecord({
			keyPair,
			lastCheck: isThisDevice ? 'entry' : 'other',
		})
		return {
			readiness: isThisDevice ? 'ready' : 'other-device',
			replacedOtherKey: false,
		}
	}

	/**
	 * The fan confirmed using this device for entry: create the key pair if
	 * needed and register it, replacing the other device's key. Never throws.
	 */
	public useThisDevice(signal?: AbortSignal): Promise<DeviceCheck> {
		return this.register(signal)
	}

	/**
	 * Sign an AdmissionCode with this device's key and return its QR text.
	 * Works without a connection. Rejects unless this is the entry device.
	 */
	public async signCode(content: AdmissionCodeContent): Promise<string> {
		const record = await this.loadRecord()
		if (record?.lastCheck !== 'entry' || !record.keyPair) {
			throw new Error('this device is not the entry device')
		}
		return signAdmissionCode(record.keyPair.privateKey, content)
	}

	/** The last saved tickets list, or undefined. Never throws. */
	public async loadSnapshot<T>(): Promise<T | undefined> {
		try {
			return await this.storage.getSnapshot<T>()
		} catch (err) {
			this.logger.warn('Saved tickets unavailable', { error: err })
			return undefined
		}
	}

	/** Save the tickets list for use without a connection. Never throws. */
	public async saveSnapshot<T>(snapshot: T): Promise<void> {
		try {
			await this.storage.putSnapshot(snapshot)
		} catch (err) {
			this.logger.warn('Saving tickets failed', { error: err })
		}
	}

	/** Remove the key pair, the entry-device state and the saved list. */
	public async clear(): Promise<void> {
		this.record = undefined
		try {
			await this.storage.clear()
		} catch (err) {
			this.logger.warn('Clearing the wallet failed', { error: err })
		}
	}

	private async register(signal?: AbortSignal): Promise<DeviceCheck> {
		const record = await this.loadRecord()
		try {
			const keyPair = record?.keyPair ?? (await this.createKeyPair(record))
			const { replacedOtherKey } = await this.keyClient.register(
				await exportRaw(keyPair),
				signal,
			)
			await this.saveRecord({ keyPair, lastCheck: 'entry' })
			return { readiness: 'ready', replacedOtherKey }
		} catch (err) {
			this.logger.warn('Registering this device failed', { error: err })
			return {
				readiness: fallbackReadiness(record),
				replacedOtherKey: false,
				failed: true,
			}
		}
	}

	private async createKeyPair(
		record: DeviceKeyRecord | undefined,
	): Promise<CryptoKeyPair> {
		// extractable: false — the private key can never be exported. (A public
		// key is always exportable, whatever this flag says.)
		const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, false, [
			'sign',
			'verify',
		])
		// Keep it before registering, so a failed call never orphans a key that
		// the server already holds.
		await this.saveRecord({
			keyPair,
			lastCheck: record?.lastCheck ?? 'unchecked',
		})
		return keyPair
	}

	private async loadRecord(): Promise<DeviceKeyRecord | undefined> {
		if (this.record) return this.record
		try {
			this.record = await this.storage.getDeviceKey()
		} catch (err) {
			this.logger.warn('Device key unavailable', { error: err })
		}
		return this.record
	}

	private async saveRecord(record: DeviceKeyRecord): Promise<void> {
		this.record = record
		try {
			await this.storage.putDeviceKey(record)
		} catch (err) {
			// Without IndexedDB the key lives for this session only.
			this.logger.warn('Saving the device key failed', { error: err })
		}
	}
}

function offlineReadiness(
	record: DeviceKeyRecord | undefined,
): DeviceReadiness {
	switch (record?.lastCheck) {
		case 'entry':
			return 'ready'
		case 'other':
			return 'other-device'
		default:
			return 'needs-connection'
	}
}

/** What the last online check still says when this check cannot finish. */
function fallbackReadiness(
	record: DeviceKeyRecord | undefined,
): DeviceReadiness {
	switch (record?.lastCheck) {
		case 'entry':
			return 'ready'
		case 'other':
			return 'other-device'
		default:
			return 'failed'
	}
}

async function exportRaw(keyPair: CryptoKeyPair): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
}
