/**
 * Base45 (RFC 9285): binary data as text in the QR alphanumeric character set,
 * so a QR code holding it uses alphanumeric mode instead of byte mode.
 */

/** The 45 characters of the QR alphanumeric mode, in Base45 order. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

const VALUE_OF: ReadonlyMap<string, number> = new Map(
	[...ALPHABET].map((ch, i) => [ch, i]),
)

/** Encode bytes as Base45 text: 2 bytes → 3 characters, a last odd byte → 2. */
export function base45Encode(bytes: Uint8Array): string {
	let out = ''
	for (let i = 0; i + 1 < bytes.length; i += 2) {
		let n = bytes[i] * 256 + bytes[i + 1]
		const c = n % 45
		n = (n - c) / 45
		const d = n % 45
		const e = (n - d) / 45
		out += ALPHABET[c] + ALPHABET[d] + ALPHABET[e]
	}
	if (bytes.length % 2 === 1) {
		const n = bytes[bytes.length - 1]
		const c = n % 45
		out += ALPHABET[c] + ALPHABET[(n - c) / 45]
	}
	return out
}

/**
 * Decode Base45 text to bytes. Returns null when the text is not Base45: a
 * character outside the alphabet, a dangling single character, or a group
 * whose value does not fit its bytes.
 */
export function base45Decode(text: string): Uint8Array | null {
	if (text.length % 3 === 1) return null
	const out = new Uint8Array(
		Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0),
	)
	let o = 0
	for (let i = 0; i < text.length; i += 3) {
		const group = text.slice(i, i + 3)
		let n = 0
		let weight = 1
		for (const ch of group) {
			const v = VALUE_OF.get(ch)
			if (v === undefined) return null
			n += v * weight
			weight *= 45
		}
		if (group.length === 3) {
			if (n > 0xffff) return null
			out[o++] = n >> 8
			out[o++] = n & 0xff
		} else {
			if (n > 0xff) return null
			out[o++] = n
		}
	}
	return out
}
