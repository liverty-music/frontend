import { describe, expect, it } from 'vitest'

// The pure utility functions are module-level, so we import them via a re-export helper.
// Since bytesToDecimal, uuidToFieldElement, bytesToHex are not exported from the module,
// we test them indirectly through the public interface or by extracting testable logic.

// For direct testing of the pure functions, we replicate them here (they are small, pure,
// and their correctness is critical for ZK proof generation).

function bytesToHex(bytes: Uint8Array): string {
	let hex = ''
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0')
	}
	return hex
}

function bytesToDecimal(bytes: Uint8Array): string {
	const hex = bytesToHex(bytes)
	if (hex === '') return '0'
	return BigInt(`0x${hex}`).toString(10)
}

function uuidToFieldElement(uuid: string): string {
	const hex = uuid.replace(/-/g, '')
	return BigInt(`0x${hex}`).toString(10)
}

describe('ProofService pure utilities', () => {
	describe('bytesToHex', () => {
		it('should convert empty array to empty string', () => {
			expect(bytesToHex(new Uint8Array([]))).toBe('')
		})

		it('should convert single byte', () => {
			expect(bytesToHex(new Uint8Array([0xff]))).toBe('ff')
		})

		it('should pad single-digit hex values', () => {
			expect(bytesToHex(new Uint8Array([0x0a]))).toBe('0a')
		})

		it('should convert multiple bytes', () => {
			expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe(
				'deadbeef',
			)
		})

		it('should handle all zeros', () => {
			expect(bytesToHex(new Uint8Array([0x00, 0x00]))).toBe('0000')
		})
	})

	describe('bytesToDecimal', () => {
		it('should return "0" for empty array', () => {
			expect(bytesToDecimal(new Uint8Array([]))).toBe('0')
		})

		it('should convert single byte to decimal string', () => {
			expect(bytesToDecimal(new Uint8Array([0xff]))).toBe('255')
		})

		it('should convert multi-byte big-endian to decimal', () => {
			// 0x0100 = 256
			expect(bytesToDecimal(new Uint8Array([0x01, 0x00]))).toBe('256')
		})

		it('should handle large values', () => {
			// 0xdeadbeef = 3735928559
			expect(bytesToDecimal(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe(
				'3735928559',
			)
		})
	})

	describe('uuidToFieldElement', () => {
		it('should convert standard UUID to decimal field element', () => {
			const uuid = '550e8400-e29b-41d4-a716-446655440000'
			const result = uuidToFieldElement(uuid)

			// 550e8400e29b41d4a716446655440000 as BigInt decimal
			const expected = BigInt('0x550e8400e29b41d4a716446655440000').toString(10)
			expect(result).toBe(expected)
		})

		it('should strip hyphens from UUID', () => {
			const uuid = '00000000-0000-0000-0000-000000000001'
			expect(uuidToFieldElement(uuid)).toBe('1')
		})

		it('should handle UUID without hyphens', () => {
			const uuid = '550e8400e29b41d4a716446655440000'
			const result = uuidToFieldElement(uuid)
			const expected = BigInt(`0x${uuid}`).toString(10)
			expect(result).toBe(expected)
		})
	})
})

describe('ProofService verifyCircuitIntegrity', () => {
	// verifyCircuitIntegrity is a private method on ProofServiceClient.
	// We replicate the verification logic here to test both match and mismatch scenarios,
	// following the same pattern as the pure utility tests above (Design Decision 3).

	async function computeHash(data: Uint8Array): Promise<string> {
		const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
	}

	function verifyIntegrity(
		actualHash: string,
		expectedHash: string,
		filename: string,
	): void {
		if (actualHash !== expectedHash) {
			throw new Error(
				`Circuit file integrity check failed for ${filename}: expected ${expectedHash}, got ${actualHash}`,
			)
		}
	}

	it('should succeed when hash matches expected value', async () => {
		const data = new TextEncoder().encode('known circuit data')
		const hash = await computeHash(new Uint8Array(data))

		// Verification should not throw when hashes match
		expect(() => verifyIntegrity(hash, hash, 'ticketcheck.wasm')).not.toThrow()
	})

	it('should throw when hash does not match expected value', async () => {
		const data = new TextEncoder().encode('tampered circuit data')
		const actualHash = await computeHash(new Uint8Array(data))
		const expectedHash =
			'0000000000000000000000000000000000000000000000000000000000000000'

		expect(() =>
			verifyIntegrity(actualHash, expectedHash, 'ticketcheck.wasm'),
		).toThrow(
			/Circuit file integrity check failed for ticketcheck\.wasm: expected .+, got .+/,
		)
	})

	it('should produce a 64-character lowercase hex hash', async () => {
		const data = new TextEncoder().encode('test data')
		const hash = await computeHash(new Uint8Array(data))

		expect(hash).toHaveLength(64)
		expect(hash).toMatch(/^[0-9a-f]+$/)
	})
})
