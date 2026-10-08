// @vitest-environment node
import { decodeQR } from '@paulmillr/qr/decode.js'
import { describe, expect, it } from 'vitest'
import {
	buildSignedBytes,
	bytesToUuid,
	decodeAdmissionCode,
	encodeAdmissionCode,
	SIGN_ALGORITHM,
	signAdmissionCode,
	uuidToBytes,
} from './admission-code'
import { base45Decode, base45Encode } from './base45'
import { admissionQrModules, admissionQrSvg } from './qr-svg'

const USER = '019a0000-0000-7000-8000-000000000001'
const EVENT = '019a0000-0000-7000-8000-0000000000e1'
const ticket = (i: number) =>
	`019a0000-0000-7000-8000-${String(i).padStart(12, '0')}`

async function newKeyPair(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign', 'verify'],
	)
}

describe('base45', () => {
	// RFC 9285 section 4.4 examples.
	it.each([
		['AB', 'BB8'],
		['Hello!!', '%69 VD92EX0'],
		['base-45', 'UJCLQE7W581'],
		['ietf!', 'QED8WEX0'],
	])('encodes %s as %s', (plain, encoded) => {
		const bytes = new TextEncoder().encode(plain)
		expect(base45Encode(bytes)).toBe(encoded)
		expect(base45Decode(encoded)).toEqual(bytes)
	})

	it('round-trips every byte value', () => {
		const bytes = Uint8Array.from({ length: 257 }, (_, i) => i % 256)
		expect(base45Decode(base45Encode(bytes))).toEqual(bytes)
	})

	it.each([
		['a dangling character', 'BB8A'],
		['a character outside the alphabet', 'bb8'],
		['a group above 65535', 'GGW'],
		['a pair above 255', '::'],
	])('rejects %s', (_, text) => {
		expect(base45Decode(text)).toBeNull()
	})
})

describe('uuid bytes', () => {
	it('round-trips the canonical form', () => {
		const bytes = uuidToBytes(EVENT)
		expect(bytes).toHaveLength(16)
		expect(bytes[15]).toBe(0xe1)
		expect(bytesToUuid(bytes)).toBe(EVENT)
	})

	it('rejects text that is not a UUID', () => {
		expect(() => uuidToBytes('ticket-1')).toThrow()
	})
})

describe('AdmissionCode payload', () => {
	it('lays out the fields exactly as admission_code.proto documents', () => {
		const bytes = buildSignedBytes({
			userId: USER,
			eventId: EVENT,
			ticketIds: [ticket(1)],
			signTime: 0x6a2b3c4d,
		})
		// 1 + 16 + 16 + 1 + 16 + 4 bytes before the signature.
		expect(bytes).toHaveLength(54)
		expect(bytes[0]).toBe(0x01)
		expect(bytesToUuid(bytes.subarray(1, 17))).toBe(USER)
		expect(bytesToUuid(bytes.subarray(17, 33))).toBe(EVENT)
		expect(bytes[33]).toBe(1)
		expect(bytesToUuid(bytes.subarray(34, 50))).toBe(ticket(1))
		expect([...bytes.subarray(50, 54)]).toEqual([0x6a, 0x2b, 0x3c, 0x4d])
	})

	it('is 118 bytes for one ticket and 262 bytes / 393 characters for ten', () => {
		const sig = new Uint8Array(64)
		const one = encodeAdmissionCode(
			buildSignedBytes({
				userId: USER,
				eventId: EVENT,
				ticketIds: [ticket(1)],
				signTime: 1,
			}),
			sig,
		)
		expect(base45Decode(one)).toHaveLength(118)
		const ten = encodeAdmissionCode(
			buildSignedBytes({
				userId: USER,
				eventId: EVENT,
				ticketIds: Array.from({ length: 10 }, (_, i) => ticket(i + 1)),
				signTime: 1,
			}),
			sig,
		)
		expect(base45Decode(ten)).toHaveLength(262)
		expect(ten).toHaveLength(393)
	})

	it.each([
		['no ticket', []],
		['11 tickets', Array.from({ length: 11 }, (_, i) => ticket(i + 1))],
		['a repeated ticket', [ticket(1), ticket(1)]],
	])('refuses to build a code with %s', (_, ticketIds) => {
		expect(() =>
			buildSignedBytes({
				userId: USER,
				eventId: EVENT,
				ticketIds,
				signTime: 1,
			}),
		).toThrow()
	})

	it('decodes nothing from an ordinary QR text or a wrong length', () => {
		expect(decodeAdmissionCode('https://liverty-music.app/')).toBeNull()
		expect(decodeAdmissionCode(base45Encode(new Uint8Array(117)))).toBeNull()
	})
})

describe('signed AdmissionCode (test vector cross-check)', () => {
	it('decodes back to its content and verifies with the exported public key', async () => {
		const keys = await newKeyPair()
		const content = {
			userId: USER,
			eventId: EVENT,
			ticketIds: [ticket(1), ticket(2), ticket(3)],
			signTime: 1_791_000_000,
		}
		const text = await signAdmissionCode(keys.privateKey, content)

		// Only QR alphanumeric characters, so the code uses alphanumeric mode.
		expect(text).toMatch(/^[0-9A-Z $%*+\-./:]+$/)

		const decoded = decodeAdmissionCode(text)
		expect(decoded).not.toBeNull()
		expect(decoded?.userId).toBe(USER)
		expect(decoded?.eventId).toBe(EVENT)
		expect(decoded?.ticketIds).toEqual(content.ticketIds)
		expect(decoded?.signTime).toBe(content.signTime)
		expect(decoded?.signature).toHaveLength(64)

		// The server holds only the raw 65-byte public key (entity.v1.PublicKey).
		const raw = new Uint8Array(
			await crypto.subtle.exportKey('raw', keys.publicKey),
		)
		expect(raw).toHaveLength(65)
		expect(raw[0]).toBe(0x04)
		const serverKey = await crypto.subtle.importKey(
			'raw',
			raw,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify'],
		)
		const signedBytes = decoded?.signedBytes ?? new Uint8Array()
		const signature = decoded?.signature ?? new Uint8Array()
		expect(
			await crypto.subtle.verify(
				SIGN_ALGORITHM,
				serverKey,
				signature,
				signedBytes,
			),
		).toBe(true)

		// A ticket added to the content no longer verifies.
		const changed = buildSignedBytes({
			...content,
			ticketIds: [...content.ticketIds, ticket(4)],
		})
		expect(
			await crypto.subtle.verify(SIGN_ALGORITHM, serverKey, signature, changed),
		).toBe(false)
	})

	it('reads back from the rendered QR code', () => {
		// A fixed signature keeps the code deterministic: the library decoder
		// misses a few percent of random, perfectly rendered codes (measured
		// in the task 0.4 spike), which would make a random signature flaky.
		const signature = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff)
		const text = encodeAdmissionCode(
			buildSignedBytes({
				userId: USER,
				eventId: EVENT,
				ticketIds: Array.from({ length: 10 }, (_, i) => ticket(i + 1)),
				signTime: 1_791_000_000,
			}),
			signature,
		)

		// Rasterise the modules (4-module quiet zone, 4 px per module) and decode.
		const modules = admissionQrModules(text)
		const scale = 4
		const quiet = 4
		const size = (modules.length + quiet * 2) * scale
		const data = new Uint8Array(size * size * 4).fill(255)
		modules.forEach((row, y) => {
			row.forEach((dark, x) => {
				if (!dark) return
				for (let dy = 0; dy < scale; dy++) {
					for (let dx = 0; dx < scale; dx++) {
						const px =
							((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx
						data.fill(0, px * 4, px * 4 + 3)
					}
				}
			})
		})
		expect(decodeQR({ width: size, height: size, data })).toBe(text)

		const svg = admissionQrSvg(text)
		expect(svg).toContain('fill="#fff"')
		expect(svg.startsWith('<svg')).toBe(true)
	})
})
