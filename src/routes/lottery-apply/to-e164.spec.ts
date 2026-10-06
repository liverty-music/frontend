import { describe, expect, it } from 'vitest'
import { toE164 } from './to-e164'

describe('toE164', () => {
	// @spec components/infrastructure/fan/web/route/lottery-apply "Domestic number with hyphens"
	it('converts a hyphenated domestic mobile number', () => {
		expect(toE164('090-1234-5678')).toBe('+819012345678')
	})

	// @spec components/infrastructure/fan/web/route/lottery-apply "Landline number"
	it('converts a 10-digit domestic landline number with spaces', () => {
		expect(toE164('03 1234 5678')).toBe('+81312345678')
	})

	it('converts a domestic number with parentheses', () => {
		expect(toE164('(03) 1234-5678')).toBe('+81312345678')
	})

	// @spec components/infrastructure/fan/web/route/lottery-apply "E.164 number with spaces"
	it('strips separators from an E.164 number', () => {
		expect(toE164('+81 90 1234 5678')).toBe('+819012345678')
	})

	it('keeps a compact E.164 number as is', () => {
		expect(toE164('+819012345678')).toBe('+819012345678')
	})

	// @spec components/infrastructure/fan/web/route/lottery-apply "Number fits neither form"
	it.each([
		'12345',
		'9012345678',
		'',
		'090-123-456',
		'090-1234-56789-0',
		'+0123456789',
		'+1234567890123456',
		'090-1234-abcd',
	])('rejects %j', (input) => {
		expect(toE164(input)).toBeNull()
	})
})
