import type {
	AdmitResponse,
	OpenResponse,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception/v1/reception_service_pb.js'
import { ReceptionService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception/v1/reception_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import {
	base64urlNoPad,
	buildReceptionSignatureInput,
	RECEPTION_SIGN_ALGORITHM,
} from '../reception/call-signature'
import { IReceptionKeyStore } from './reception-key-store'
import { createReceptionTransport } from './reception-transport'

export type { AdmitResponse, OpenResponse }

/** The device key pair: ECDSA over P-256, as ReceptionLink binding requires. */
const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }

/** The full Connect procedure path of a ReceptionService method. */
export function receptionProcedure(method: 'open' | 'admit'): string {
	return `/${ReceptionService.typeName}/${ReceptionService.method[method].name}`
}

export const IReceptionClient = DI.createInterface<IReceptionClient>(
	'IReceptionClient',
	(x) => x.singleton(ReceptionClient),
)

export interface IReceptionClient extends ReceptionClient {}

/**
 * The reception device's side of ReceptionService. It owns the device key pair
 * of each link (created on first open, non-extractable, kept in IndexedDB) and
 * signs every call as the service documents. Only the public key and
 * signatures leave the device; the private key is only ever handed to
 * `crypto.subtle.sign`.
 *
 * Errors propagate as `ConnectError`s; the reception screen decides what each
 * means for staff.
 */
export class ReceptionClient {
	private readonly logger = resolve(ILogger).scopeTo('ReceptionClient')
	private readonly store = resolve(IReceptionKeyStore)
	private readonly client = createClient(
		ReceptionService,
		createReceptionTransport(
			resolve(ILogger).scopeTo('ReceptionTransport'),
			resolve(IAppConfig),
		),
	)

	/** Key pairs already loaded, also the fallback when IndexedDB is unavailable. */
	private readonly keys = new Map<string, Promise<CryptoKeyPair>>()

	/**
	 * Opens the link on this device: binds it to this device's public key on
	 * first use and returns the link and its reception window.
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
			receptionProcedure('open'),
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
			receptionProcedure('admit'),
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
		const data = buildReceptionSignatureInput({
			procedure,
			linkToken,
			signTime,
			content,
		})
		const signature = new Uint8Array(
			await crypto.subtle.sign(
				RECEPTION_SIGN_ALGORITHM,
				keyPair.privateKey,
				data,
			),
		)
		return { signTime, signature }
	}

	/** This device's key pair for the link, created on first use. */
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
			this.logger.warn('Stored reception key unavailable', { error: err })
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
			// which the bound link then refuses as another device.
			this.logger.warn('Saving the reception key failed', { error: err })
		}
		return keyPair
	}
}
