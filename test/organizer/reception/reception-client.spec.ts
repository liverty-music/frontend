import {
	AdmitRequestSchema,
	OpenRequestSchema,
	ReceptionService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/reception/v1/reception_service_pb.js'
import { toBinary } from '@bufbuild/protobuf'
import { createRouterTransport } from '@connectrpc/connect'
import { Registration } from 'aurelia'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	base64urlNoPad,
	buildReceptionSignatureInput,
	RECEPTION_SIGN_ALGORITHM,
} from '../../../organizer/reception/call-signature'
import {
	IndexedDbReceptionKeyStore,
	IReceptionKeyStore,
} from '../../../organizer/services/reception-key-store'
import { createTestContainer } from '../../helpers/create-container'

vi.mock('../../../organizer/services/reception-transport', () => ({
	createReceptionTransport: vi.fn(),
}))

const { createReceptionTransport } = await import(
	'../../../organizer/services/reception-transport'
)
const { ReceptionClient } = await import(
	'../../../organizer/services/reception-client'
)

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const EC = { name: 'ECDSA', namedCurve: 'P-256' } as const

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer
		}
		return true
	}
	return false
}

function base64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

interface Sent {
	procedure: string
	body: Uint8Array
	linkToken: string
	signTime: bigint
	signature: Uint8Array
	content: string
	publicKey?: Uint8Array
}

describe('ReceptionClient', () => {
	let sent: Sent[]

	beforeEach(() => {
		sent = []
		vi.mocked(createReceptionTransport).mockReturnValue(
			createRouterTransport(({ service }) => {
				service(ReceptionService, {
					open: (req) => {
						const publicKey = req.publicKey?.value ?? new Uint8Array()
						sent.push({
							procedure:
								'/liverty_music.rpc.organizer.reception.v1.ReceptionService/Open',
							body: toBinary(OpenRequestSchema, req),
							linkToken: req.linkToken?.value ?? '',
							signTime: req.signTime?.seconds ?? 0n,
							signature: req.signature?.value ?? new Uint8Array(),
							content: base64urlNoPad(publicKey),
							publicKey,
						})
						return { receptionLink: { number: { value: 1 } } }
					},
					admit: (req) => {
						sent.push({
							procedure:
								'/liverty_music.rpc.organizer.reception.v1.ReceptionService/Admit',
							body: toBinary(AdmitRequestSchema, req),
							linkToken: req.linkToken?.value ?? '',
							signTime: req.signTime?.seconds ?? 0n,
							signature: req.signature?.value ?? new Uint8Array(),
							content: req.scannedText?.value ?? '',
						})
						return { admittedTicketCount: 1 }
					},
				})
			}),
		)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	function build(store: IndexedDbReceptionKeyStore) {
		const container = createTestContainer(
			Registration.instance(IReceptionKeyStore, store),
		)
		container.register(Registration.singleton(ReceptionClient, ReceptionClient))
		return container.get(ReceptionClient)
	}

	it('creates a non-extractable key and never sends private key material', async () => {
		// A key pair whose private scalar the test knows: made extractable here,
		// then re-imported non-extractable exactly as the device holds it.
		const known = await crypto.subtle.generateKey(EC, true, ['sign', 'verify'])
		const jwk = await crypto.subtle.exportKey('jwk', known.privateKey)
		const privateScalar = base64urlToBytes(jwk.d ?? '')
		expect(privateScalar).toHaveLength(32)
		const devicePrivate = await crypto.subtle.importKey('jwk', jwk, EC, false, [
			'sign',
		])
		const generateKey = vi
			.spyOn(crypto.subtle, 'generateKey')
			.mockResolvedValue({
				privateKey: devicePrivate,
				publicKey: known.publicKey,
			})
		const exportKey = vi.spyOn(crypto.subtle, 'exportKey')

		const store = new IndexedDbReceptionKeyStore(new IDBFactory())
		const client = build(store)
		await client.open(TOKEN)
		await client.admit(TOKEN, 'SCANNED-1')
		await client.admit(TOKEN, 'SCANNED-2')

		// Created once, non-extractable, as an ECDSA P-256 signing key.
		expect(generateKey).toHaveBeenCalledTimes(1)
		expect(generateKey).toHaveBeenCalledWith(
			EC,
			false,
			expect.arrayContaining(['sign']),
		)
		// Only the public key is ever exported, and only raw.
		for (const [format, key] of exportKey.mock.calls) {
			expect(format).toBe('raw')
			expect((key as CryptoKey).type).toBe('public')
		}
		// No request carries the private scalar.
		expect(sent).toHaveLength(3)
		for (const s of sent) expect(contains(s.body, privateScalar)).toBe(false)
		// The stored private key is still non-extractable.
		const stored = await store.get(TOKEN)
		expect(stored?.privateKey.extractable).toBe(false)
	})

	it('binds the 65-byte public key and signs every call over the documented input', async () => {
		const client = build(new IndexedDbReceptionKeyStore(new IDBFactory()))
		await client.open(TOKEN)
		await client.admit(TOKEN, 'SCANNED')

		const publicKey = sent[0].publicKey ?? new Uint8Array()
		expect(publicKey).toHaveLength(65)
		expect(publicKey[0]).toBe(0x04)
		const verifyKey = await crypto.subtle.importKey(
			'raw',
			publicKey,
			EC,
			false,
			['verify'],
		)
		for (const s of sent) {
			expect(s.linkToken).toBe(TOKEN)
			expect(s.signature).toHaveLength(64) // P1363 r || s, not DER
			const now = BigInt(Math.floor(Date.now() / 1000))
			expect(now - s.signTime).toBeLessThanOrEqual(2n)
			const data = buildReceptionSignatureInput({
				procedure: s.procedure,
				linkToken: s.linkToken,
				signTime: Number(s.signTime),
				content: s.content,
			})
			expect(
				await crypto.subtle.verify(
					RECEPTION_SIGN_ALGORITHM,
					verifyKey,
					s.signature,
					data,
				),
			).toBe(true)
		}
	})

	it('keeps one key per link across page loads', async () => {
		const factory = new IDBFactory()
		await build(new IndexedDbReceptionKeyStore(factory)).open(TOKEN)
		await build(new IndexedDbReceptionKeyStore(factory)).open(TOKEN)
		await build(new IndexedDbReceptionKeyStore(factory)).open(`${TOKEN}x`)
		expect(sent[1].publicKey).toEqual(sent[0].publicKey)
		expect(sent[2].publicKey).not.toEqual(sent[0].publicKey)
	})

	it('does not overwrite a stored key it could not read', async () => {
		const store = new IndexedDbReceptionKeyStore(new IDBFactory())
		vi.spyOn(store, 'get').mockRejectedValue(new Error('IDB broken'))
		const put = vi.spyOn(store, 'put')
		await build(store).open(TOKEN)
		expect(put).not.toHaveBeenCalled()
		expect(sent).toHaveLength(1)
	})
})
