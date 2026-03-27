// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { bytesToDecimal, bytesToHex, uuidToFieldElement } from './entry'

describe('bytesToHex', () => {
	it('converts bytes to hex string', () => {
		expect(bytesToHex(new Uint8Array([0x0a, 0xff]))).toBe('0aff')
	})

	it('returns empty string for empty input', () => {
		expect(bytesToHex(new Uint8Array([]))).toBe('')
	})

	it('zero-pads single-digit hex values', () => {
		expect(bytesToHex(new Uint8Array([0x00]))).toBe('00')
		expect(bytesToHex(new Uint8Array([0x01]))).toBe('01')
	})
})

describe('bytesToDecimal', () => {
	it('converts bytes to decimal string', () => {
		expect(bytesToDecimal(new Uint8Array([0x01, 0x00]))).toBe('256')
	})

	it('returns 0 for empty input', () => {
		expect(bytesToDecimal(new Uint8Array([]))).toBe('0')
	})

	it('handles single byte', () => {
		expect(bytesToDecimal(new Uint8Array([0xff]))).toBe('255')
	})

	it('handles three-byte input', () => {
		expect(bytesToDecimal(new Uint8Array([0x01, 0x00, 0x00]))).toBe('65536')
	})
})

describe('uuidToFieldElement', () => {
	it('strips hyphens and converts to decimal', () => {
		const result = uuidToFieldElement('550e8400-e29b-41d4-a716-446655440000')
		expect(result).toBe(
			BigInt('0x550e8400e29b41d4a716446655440000').toString(10),
		)
	})

	it('handles UUID without hyphens', () => {
		const hyphenated = uuidToFieldElement(
			'550e8400-e29b-41d4-a716-446655440000',
		)
		const stripped = uuidToFieldElement('550e8400e29b41d4a716446655440000')
		expect(stripped).toBe(hyphenated)
	})
})
