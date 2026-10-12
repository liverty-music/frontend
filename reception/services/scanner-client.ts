import type {
	AdmitResponse,
	OpenResponse,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/scanner/v1/scanner_service_pb.js'
import { ScannerService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/scanner/v1/scanner_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IReceptionConfig } from '../config/reception-config'
import {
	base64urlNoPad,
	buildScannerSignatureInput,
	SCANNER_SIGN_ALGORITHM,
} from '../scanner-route/call-signature'
import { IScannerKeyStore } from './scanner-key-store'
import { createScannerTransport } from './scanner-transport'

export type { AdmitResponse, OpenResponse }

/** The device key pair: ECDSA over P-256, as Scanner binding requires. */
const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }

/** The full Connect procedure path of a device ScannerService method. */
export function scannerProcedure(method: 'open' | 'admit'): string {
	return `/${ScannerService.typeName}/${ScannerService.method[method].name}`
}

export const IScannerClient = DI.createInterface<IScannerClient>(
	'IScannerClient',
	(x) => x.singleton(ScannerClient),
)

export interface IScannerClient extends ScannerClient {}

/**
 * The scanner device's side of rpc.scanner.v1.ScannerService. It owns the
 * device key pair of each Scanner (created on first open, non-extractable,
 * kept in IndexedDB, keyed by the link token) and signs every call as the
 * service documents. Only the public key and
 * signatures leave the device; the private key is only ever handed to
 * `crypto.subtle.sign`.
 *
 * Errors propagate as `ConnectError`s; the scanner screen decides what each
 * means for staff.
 */
export class ScannerClient {
	private readonly logger = resolve(ILogger).scopeTo('ScannerClient')
	private readonly store = resolve(IScannerKeyStore)
	private readonly client = createClient(
		ScannerService,
		createScannerTransport(
			resolve(ILogger).scopeTo('ScannerTransport'),
			resolve(IReceptionConfig),
		),
	)

	/** Key pairs already loaded, also the fallback when IndexedDB is unavailable. */
	private readonly keys = new Map<string, Promise<CryptoKeyPair>>()

	/**
	 * Opens the Scanner's link on this device: binds the Scanner to this
	 * device's public key on first use and returns the Scanner and the event's
	 * admission window.
	 */
	public async open(
		linkToken: string,
		signal?: AbortSignal,
	): Promise<OpenResponse> {
		const keyPair = await this.keyPair(linkToken)
		const publicKey = new Uint8Array(
			await crypto.subtle.exportKey('raw', keyPair.publicKey),
		)
		const signed = await this.sign(
			keyPair,
			scannerProcedure('open'),
			linkToken,
			base64urlNoPad(publicKey),
		)
		return this.client.open(
			{
				linkToken: { value: linkToken },
				signTime: { seconds: BigInt(signed.signTime), nanos: 0 },
				signature: { value: signed.signature },
				publicKey: { value: publicKey },
			},
			{ signal },
		)
	}

	/** Sends one scan, signed by this device, and returns the decision. */
	public async admit(
		linkToken: string,
		scannedText: string,
		signal?: AbortSignal,
	): Promise<AdmitResponse> {
		const keyPair = await this.keyPair(linkToken)
		const signed = await this.sign(
			keyPair,
			scannerProcedure('admit'),
			linkToken,
			scannedText,
		)
		return this.client.admit(
			{
				linkToken: { value: linkToken },
				signTime: { seconds: BigInt(signed.signTime), nanos: 0 },
				signature: { value: signed.signature },
				scannedText: { value: scannedText },
			},
			{ signal },
		)
	}

	private async sign(
		keyPair: CryptoKeyPair,
		procedure: string,
		linkToken: string,
		content: string,
	): Promise<{ signTime: number; signature: Uint8Array<ArrayBuffer> }> {
		const signTime = Math.floor(Date.now() / 1000)
		const data = buildScannerSignatureInput({
			procedure,
			linkToken,
			signTime,
			content,
		})
		const signature = new Uint8Array(
			await crypto.subtle.sign(
				SCANNER_SIGN_ALGORITHM,
				keyPair.privateKey,
				data,
			),
		)
		return { signTime, signature }
	}

	/** This device's key pair for the Scanner, created on first use. */
	private keyPair(linkToken: string): Promise<CryptoKeyPair> {
		let pending = this.keys.get(linkToken)
		if (!pending) {
			pending = this.loadOrCreate(linkToken)
			this.keys.set(linkToken, pending)
			pending.catch(() => this.keys.delete(linkToken))
		}
		return pending
	}

	private async loadOrCreate(linkToken: string): Promise<CryptoKeyPair> {
		let readable = true
		try {
			const stored = await this.store.get(linkToken)
			if (stored) return stored
		} catch (err) {
			readable = false
			this.logger.warn('Stored scanner key unavailable', { error: err })
		}
		// extractable: false — the private key can never be exported. (A public
		// key is always exportable, whatever this flag says.)
		const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, false, [
			'sign',
			'verify',
		])
		// Never overwrite a key that could not be read: it may be the bound one.
		if (!readable) return keyPair
		try {
			await this.store.put(linkToken, keyPair)
		} catch (err) {
			// The key still works for this page; a reload would make a new one,
			// which the bound Scanner then refuses as another device.
			this.logger.warn('Saving the scanner key failed', { error: err })
		}
		return keyPair
	}
}
