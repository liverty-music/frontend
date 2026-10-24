import { describe, expect, it } from 'vitest'
import { EMPTY, formatDateValue } from '../../../admin/lib/local-date'

describe('formatDateValue', () => {
	it('pads a single-digit month and day', () => {
		expect(formatDateValue({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07')
	})

	it('keeps two-digit parts as they are', () => {
		expect(formatDateValue({ year: 2026, month: 11, day: 20 })).toBe(
			'2026-11-20',
		)
	})

	it('shows the placeholder for a missing date', () => {
		expect(formatDateValue(undefined)).toBe(EMPTY)
	})
})
