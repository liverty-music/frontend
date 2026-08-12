import { describe, expect, it } from 'vitest'
import type { CalendarDate } from '../../lib/plain-date'
import {
	calendarDatesEqual,
	type DateRange,
	formatDateInput,
	formatRangeLabel,
	inclusiveDaySpan,
	MAX_RANGE_DAYS,
	matchPreset,
	parseDateInput,
	rangeCacheKey,
	resolvePreset,
} from './date-presets'

// A fixed reference date keeps every preset computation deterministic across
// machines/timezones. 2026-08-12 is a Wednesday. The `today` argument is a
// `CalendarDate` (never a native `Date`) so it stays on the engine-agnostic
// boundary.
const WED: CalendarDate = { year: 2026, month: 8, day: 12 }

describe('resolvePreset', () => {
	it('week spans today through +6 days inclusive (7 days)', () => {
		const range = resolvePreset('week', WED)
		expect(range).toEqual({
			from: { year: 2026, month: 8, day: 12 },
			to: { year: 2026, month: 8, day: 18 },
		})
		expect(range && inclusiveDaySpan(range.from, range.to)).toBe(7)
	})

	it('month spans MAX_RANGE_DAYS inclusive days', () => {
		const range = resolvePreset('month', WED)
		expect(range?.from).toEqual({ year: 2026, month: 8, day: 12 })
		expect(range && inclusiveDaySpan(range.from, range.to)).toBe(MAX_RANGE_DAYS)
	})

	describe('weekend rule', () => {
		it('Mon–Fri → the coming Sat..Sun', () => {
			// Wednesday 2026-08-12 → Saturday 2026-08-15, Sunday 2026-08-16.
			const range = resolvePreset('weekend', WED)
			expect(range).toEqual({
				from: { year: 2026, month: 8, day: 15 },
				to: { year: 2026, month: 8, day: 16 },
			})
		})

		it('Saturday → today (Sat)..tomorrow (Sun)', () => {
			const sat: CalendarDate = { year: 2026, month: 8, day: 15 }
			expect(resolvePreset('weekend', sat)).toEqual({
				from: { year: 2026, month: 8, day: 15 },
				to: { year: 2026, month: 8, day: 16 },
			})
		})

		it('Sunday → single-day today range', () => {
			const sun: CalendarDate = { year: 2026, month: 8, day: 16 }
			expect(resolvePreset('weekend', sun)).toEqual({
				from: { year: 2026, month: 8, day: 16 },
				to: { year: 2026, month: 8, day: 16 },
			})
		})
	})
})

describe('matchPreset', () => {
	it('identifies a range that matches a preset', () => {
		const week = resolvePreset('week', WED)
		expect(week && matchPreset(week, WED)).toBe('week')
	})

	it('returns null for a custom range that matches no preset', () => {
		const custom: DateRange = {
			from: { year: 2026, month: 8, day: 12 },
			to: { year: 2026, month: 8, day: 20 },
		}
		expect(matchPreset(custom, WED)).toBeNull()
	})
})

describe('inclusiveDaySpan', () => {
	it('is 1 for a single day', () => {
		const d = { year: 2026, month: 8, day: 12 }
		expect(inclusiveDaySpan(d, d)).toBe(1)
	})

	it('counts both bounds inclusively', () => {
		expect(
			inclusiveDaySpan(
				{ year: 2026, month: 8, day: 12 },
				{ year: 2026, month: 8, day: 20 },
			),
		).toBe(9)
	})

	it('crosses month boundaries correctly', () => {
		expect(
			inclusiveDaySpan(
				{ year: 2026, month: 8, day: 12 },
				{ year: 2026, month: 9, day: 21 },
			),
		).toBe(41)
	})

	it('is negative when the range is inverted (drives the order guard)', () => {
		expect(
			inclusiveDaySpan(
				{ year: 2026, month: 8, day: 20 },
				{ year: 2026, month: 8, day: 12 },
			),
		).toBeLessThan(1)
	})
})

describe('formatRangeLabel', () => {
	it('renders a single localized day when from === to', () => {
		const day = { year: 2026, month: 8, day: 12 }
		expect(formatRangeLabel({ from: day, to: day })).toBe('8/12')
	})

	it('joins two localized days with a wave dash for a multi-day range', () => {
		expect(
			formatRangeLabel({
				from: { year: 2026, month: 8, day: 12 },
				to: { year: 2026, month: 8, day: 20 },
			}),
		).toBe('8/12〜8/20')
	})
})

describe('parseDateInput / formatDateInput', () => {
	it('round-trips a valid value', () => {
		const date = { year: 2026, month: 8, day: 5 }
		expect(formatDateInput(date)).toBe('2026-08-05')
		expect(parseDateInput('2026-08-05')).toEqual(date)
	})

	it('returns null for empty or malformed input', () => {
		expect(parseDateInput('')).toBeNull()
		expect(parseDateInput('2026/08/05')).toBeNull()
		expect(parseDateInput('2026-13-01')).toBeNull()
		expect(parseDateInput('2026-08-00')).toBeNull()
	})
})

describe('helpers', () => {
	it('calendarDatesEqual compares by fields', () => {
		expect(
			calendarDatesEqual(
				{ year: 2026, month: 8, day: 12 },
				{ year: 2026, month: 8, day: 12 },
			),
		).toBe(true)
		expect(
			calendarDatesEqual(
				{ year: 2026, month: 8, day: 12 },
				{ year: 2026, month: 8, day: 13 },
			),
		).toBe(false)
	})

	it('rangeCacheKey is stable for the same area + range', () => {
		const from = { year: 2026, month: 8, day: 12 }
		const to = { year: 2026, month: 8, day: 20 }
		expect(rangeCacheKey('JP-13', from, to)).toBe('JP-13|2026-08-12|2026-08-20')
	})
})
