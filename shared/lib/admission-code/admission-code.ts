import { base45Decode, base45Encode } from './base45'

/**
 * The AdmissionCode wire format (entity.v1.AdmissionCode, layout version 1):
 * the text a fan's device shows as the entry QR code. Big-endian, ids as the
 * 16 raw bytes of the UUID, Base45 text:
 *
 *   version 0x01 (1) · user id (16) · event id (16) · ticket count N, 1-10 (1)
 *   · N ticket ids (16 each) · signed time, Unix seconds (4) · signature (64)
 *
 * The signature is ECDSA P-256 / SHA-256 in IEEE P1363 `r || s` form over
 * every byte before it, which is what WebCrypto produces.
 */

export const ADMISSION_CODE_VERSION = 0x01

/** At most this many tickets are presented by one code. */
export const MAX_TICKETS_PER_CODE = 10

/** A device makes a new code this often, and never shows an older one. */
export const CODE_ROTATION_MS = 15_000

const ID_BYTES = 16
const TIME_BYTES = 4
const SIGNATURE_BYTES = 64
/** Bytes of a payload around its ticket ids: 1 + 16 + 16 + 1 + 4 + 64. */
const FIXED_BYTES = 1 + ID_BYTES * 2 + 1 + TIME_BYTES + SIGNATURE_BYTES

/** ECDSA over P-256 with SHA-256, as the platform verifies it. */
export const SIGN_ALGORITHM: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' }

/** What an AdmissionCode states, before it is signed. */
export interface AdmissionCodeContent {
	readonly userId: string
	readonly eventId: string
	readonly ticketIds: readonly string[]
	/** Unix seconds by the device's clock. */
	readonly signTime: number
}

/** A decoded AdmissionCode, with the bytes its signature covers. */
export interface DecodedAdmissionCode extends AdmissionCodeContent {
	readonly signedBytes: Uint8Array<ArrayBuffer>
	readonly signature: Uint8Array<ArrayBuffer>
}

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The 16 raw bytes of a UUID in its canonical text form. */
export function uuidToBytes(uuid: string): Uint8Array {
	if (!UUID_PATTERN.test(uuid)) {
		throw new Error(`not a UUID: ${uuid}`)
	}
	const hex = uuid.replace(/-/g, '')
	const out = new Uint8Array(ID_BYTES)
	for (let i = 0; i < ID_BYTES; i++) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	}
	return out
}

/** The canonical lower-case text form of 16 UUID bytes. */
export function bytesToUuid(bytes: Uint8Array): string {
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * The bytes the signature covers: every field of the payload before the
 * signature. Throws when the content cannot form a valid code (no ticket, more
 * than 10, a repeated ticket, a time outside 32 bits or a non-UUID id).
 */
export function buildSignedBytes(
	content: AdmissionCodeContent,
): Uint8Array<ArrayBuffer> {
	const n = content.ticketIds.length
	if (n < 1 || n > MAX_TICKETS_PER_CODE) {
		throw new Error(`a code presents 1 to 10 tickets, not ${n}`)
	}
	if (new Set(content.ticketIds.map((t) => t.toLowerCase())).size !== n) {
		throw new Error('a code presents each ticket at most once')
	}
	if (
		!Number.isInteger(content.signTime) ||
		content.signTime < 0 ||
		content.signTime > 0xffffffff
	) {
		throw new Error(`signed time out of range: ${content.signTime}`)
	}
	const out = new Uint8Array(FIXED_BYTES - SIGNATURE_BYTES + ID_BYTES * n)
	let o = 0
	out[o++] = ADMISSION_CODE_VERSION
	out.set(uuidToBytes(content.userId), o)
	o += ID_BYTES
	out.set(uuidToBytes(content.eventId), o)
	o += ID_BYTES
	out[o++] = n
	for (const id of content.ticketIds) {
		out.set(uuidToBytes(id), o)
		o += ID_BYTES
	}
	new DataView(out.buffer).setUint32(o, content.signTime, false)
	return out
}

/** The Base45 text of a payload: the signed bytes followed by the signature. */
export function encodeAdmissionCode(
	signedBytes: Uint8Array,
	signature: Uint8Array,
): string {
	if (signature.length !== SIGNATURE_BYTES) {
		throw new Error(`signature must be 64 bytes, not ${signature.length}`)
	}
	const payload = new Uint8Array(signedBytes.length + SIGNATURE_BYTES)
	payload.set(signedBytes)
	payload.set(signature, signedBytes.length)
	return base45Encode(payload)
}

/**
 * Sign the content with the device's private key and return the QR text. The
 * key never leaves WebCrypto; only the signature is read back.
 */
export async function signAdmissionCode(
	privateKey: CryptoKey,
	content: AdmissionCodeContent,
	subtle: SubtleCrypto = crypto.subtle,
): Promise<string> {
	const signedBytes = buildSignedBytes(content)
	const signature = new Uint8Array(
		await subtle.sign(SIGN_ALGORITHM, privateKey, signedBytes),
	)
	return encodeAdmissionCode(signedBytes, signature)
}

/**
 * Read the QR text back into its content without checking the signature.
 * Returns null for text that is not an AdmissionCode of this layout.
 */
export function decodeAdmissionCode(text: string): DecodedAdmissionCode | null {
	const bytes = base45Decode(text)
	if (!bytes || bytes.length < FIXED_BYTES + ID_BYTES) return null
	if (bytes[0] !== ADMISSION_CODE_VERSION) return null
	const n = bytes[33]
	if (n < 1 || n > MAX_TICKETS_PER_CODE) return null
	if (bytes.length !== FIXED_BYTES + ID_BYTES * n) return null
	const ticketIds: string[] = []
	for (let i = 0; i < n; i++) {
		const start = 34 + ID_BYTES * i
		ticketIds.push(bytesToUuid(bytes.subarray(start, start + ID_BYTES)))
	}
	if (new Set(ticketIds).size !== n) return null
	const timeAt = 34 + ID_BYTES * n
	return {
		userId: bytesToUuid(bytes.subarray(1, 17)),
		eventId: bytesToUuid(bytes.subarray(17, 33)),
		ticketIds,
		signTime: new DataView(bytes.buffer).getUint32(timeAt, false),
		signedBytes: bytes.slice(0, timeAt + TIME_BYTES),
		signature: bytes.slice(timeAt + TIME_BYTES),
	}
}
