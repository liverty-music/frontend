/**
 * Merkle path data needed for zero-knowledge entry proof generation.
 * @source proto/liverty_music/rpc/entry/v1/entry_service.proto — GetMerklePathResponse
 */
export interface MerklePath {
	readonly pathElements: Uint8Array[]
	readonly pathIndices: number[]
	readonly merkleRoot: Uint8Array
	readonly leaf: Uint8Array
}

/**
 * Convert a byte array to a lowercase hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
	let hex = ''
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0')
	}
	return hex
}

/**
 * Convert big-endian bytes to a decimal string.
 * Used for snarkjs circuit inputs which require decimal strings.
 */
export function bytesToDecimal(bytes: Uint8Array): string {
	const hex = bytesToHex(bytes)
	if (hex === '') return '0'
	return BigInt(`0x${hex}`).toString(10)
}

/**
 * Convert a UUID to a decimal field element by stripping hyphens
 * and interpreting the hex as a big-endian integer.
 */
export function uuidToFieldElement(uuid: string): string {
	const hex = uuid.replace(/-/g, '')
	return BigInt(`0x${hex}`).toString(10)
}
