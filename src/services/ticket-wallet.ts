import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import { ITicketRpcClient } from '../adapter/rpc/client/ticket-client'
import {
	type DeviceKeyRecord,
	IWalletStorage,
} from '../adapter/storage/wallet-storage'
import {
	type AdmissionCodeContent,
	signAdmissionCode,
} from '../lib/admission-code/admission-code'
import { SignedOut } from './events/signed-out'

export const ITicketWallet = DI.createInterface<ITicketWallet>(
	'ITicketWallet',
	(x) => x.singleton(TicketWallet),
)

export interface ITicketWallet extends TicketWallet {}

/** The device key pair: ECDSA over P-256, as WalletPublicKey requires. */
const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }

/**
 * Whether this device can show an entry QR code:
 * - `ready`: its public key is registered; codes can be made offline.
 * - `needs-connection`: it has never been registered and is offline now.
 * - `failed`: online, but registering failed; a reload retries.
 */
export type DeviceReadiness = 'ready' | 'needs-connection' | 'failed'

export interface DevicePreparation {
	readonly readiness: DeviceReadiness
	/** True when registering moved the fan's key here from another device. */
	readonly replacedOtherKey: boolean
}

/**
 * The fan's ticket wallet on this device: the device key pair that signs
 * entry QR codes, and the last loaded tickets list for use without a
 * connection.
 *
 * The private key is created non-extractable and kept as a `CryptoKey` in
 * IndexedDB; it is only ever handed to `crypto.subtle.sign`. Only the public
 * key is sent (TicketService.RegisterWalletPublicKey). Both the key pair and
 * the saved list are removed on sign-out, so the next person on a shared
 * browser starts clean.
 */
export class TicketWallet {
	private readonly logger = resolve(ILogger).scopeTo('TicketWallet')
	private readonly storage = resolve(IWalletStorage)
	private readonly ticketClient = resolve(ITicketRpcClient)
	private readonly ea = resolve(IEventAggregator)

	/** Last known key record; also the fallback when IndexedDB is unavailable. */
	private record: DeviceKeyRecord | undefined

	constructor() {
		this.ea.subscribe(SignedOut, () => void this.clear())
	}

	/**
	 * Prepare this device to show tickets. Online, it creates the key pair when
	 * there is none and registers the public key, which makes this device the
	 * one that shows the fan's tickets (registering the key the fan already has
	 * changes nothing). Offline, it only reports whether an earlier visit did so.
	 * Never throws.
	 */
	public async prepareDevice(
		online: boolean,
		signal?: AbortSignal,
	): Promise<DevicePreparation> {
		const existing = await this.loadRecord()
		if (!online) {
			return {
				readiness: existing?.registered ? 'ready' : 'needs-connection',
				replacedOtherKey: false,
			}
		}
		try {
			const keyPair = existing?.keyPair ?? (await this.createKeyPair())
			const publicKey = new Uint8Array(
				await crypto.subtle.exportKey('raw', keyPair.publicKey),
			)
			const { replacedOtherKey } =
				await this.ticketClient.registerWalletPublicKey(publicKey, signal)
			await this.saveRecord({ keyPair, registered: true })
			return { readiness: 'ready', replacedOtherKey }
		} catch (err) {
			this.logger.warn('Device preparation failed', { error: err })
			// A key registered on an earlier visit still makes valid codes.
			return {
				readiness: existing?.registered ? 'ready' : 'failed',
				replacedOtherKey: false,
			}
		}
	}

	/**
	 * Sign an AdmissionCode with the registered device key and return its QR
	 * text. Works without a connection. Rejects when the device is not ready.
	 */
	public async signCode(content: AdmissionCodeContent): Promise<string> {
		const record = await this.loadRecord()
		if (!record?.registered) {
			throw new Error('device is not prepared to show tickets')
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

	/** Remove the key pair and the saved list. Never throws. */
	public async clear(): Promise<void> {
		this.record = undefined
		try {
			await this.storage.clear()
		} catch (err) {
			this.logger.warn('Clearing the wallet failed', { error: err })
		}
	}

	private async createKeyPair(): Promise<CryptoKeyPair> {
		// extractable: false — the private key can never be exported. (A public
		// key is always exportable, whatever this flag says.)
		const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, false, [
			'sign',
			'verify',
		])
		// Keep it before registering, so a failed call never orphans a key that
		// the server already holds.
		await this.saveRecord({ keyPair, registered: false })
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
