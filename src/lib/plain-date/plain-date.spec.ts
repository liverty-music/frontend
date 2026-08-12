import { Temporal } from '@js-temporal/polyfill'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as dateEngine from './date-impl'
import * as temporalEngine from './temporal-impl'
import type { CalendarDate, CalendarDateEngine } from './types'

// The Temporal engine reads `globalThis.Temporal` at call time. Node (and jsdom)
// have no native Temporal yet, so install the polyfill for THIS suite only and
// remove it afterwards, so it never leaks into other test files that share the
// worker's globalThis.
const hadTemporal = 'Temporal' in globalThis
beforeAll(() => {
	if (!hadTemporal) {
		;(globalThis as { Temporal?: unknown }).Temporal = Temporal
	}
})
afterAll(() => {
	if (!hadTemporal) {
		;(globalThis as { Temporal?: unknown }).Temporal = undefined
	}
})

const engines: ReadonlyArray<readonly [string, CalendarDateEngine]> = [
	['date', dateEngine],
	['temporal', temporalEngine],
]

// Valid days spanning every weekday, month/year boundaries, and leap day.
const VALID: CalendarDate[] = [
	{ year: 2026, month: 8, day: 10 }, // Monday
	{ year: 2026, month: 8, day: 12 }, // Wednesday
	{ year: 2026, month: 8, day: 14 }, // Friday
	{ year: 2026, month: 8, day: 15 }, // Saturday
	{ year: 2026, month: 8, day: 16 }, // Sunday
	{ year: 2026, month: 1, day: 1 },
	{ year: 2026, month: 12, day: 31 },
	{ year: 2024, month: 2, day: 29 }, // leap day
	{ year: 2026, month: 2, day: 28 },
]

const DELTAS = [-400, -31, -1, 0, 1, 6, 29, 30, 366]

// Impossible/out-of-domain components. A native `Date` would silently roll
// these over; both engines must reject them instead.
const INVALID: CalendarDate[] = [
	{ year: 2026, month: 0, day: 15 }, // zero month — the classic footgun
	{ year: 2026, month: 13, day: 1 },
	{ year: 2026, month: 8, day: 0 },
	{ year: 2026, month: 8, day: 32 },
	{ year: 2026, month: 2, day: 30 }, // impossible day-of-month
	{ year: 2025, month: 2, day: 29 }, // Feb 29 in a non-leap year
]

describe('plain-date engines are differentially equivalent', () => {
	it('addDays agrees across engines for every date × delta', () => {
		for (const base of VALID) {
			for (const delta of DELTAS) {
				expect(temporalEngine.addDays(base, delta)).toEqual(
					dateEngine.addDays(base, delta),
				)
			}
		}
	})

	it('resolveWeekend agrees across engines for every date', () => {
		for (const base of VALID) {
			expect(temporalEngine.resolveWeekend(base)).toEqual(
				dateEngine.resolveWeekend(base),
			)
		}
	})

	it('inclusiveDaySpan agrees across engines for every ordered and inverted pair', () => {
		for (const from of VALID) {
			for (const to of VALID) {
				expect(temporalEngine.inclusiveDaySpan(from, to)).toBe(
					dateEngine.inclusiveDaySpan(from, to),
				)
			}
		}
	})

	it('isValidCalendarDate agrees across engines (valid and invalid)', () => {
		for (const d of VALID) {
			expect(dateEngine.isValidCalendarDate(d)).toBe(true)
			expect(temporalEngine.isValidCalendarDate(d)).toBe(true)
		}
		for (const d of INVALID) {
			expect(dateEngine.isValidCalendarDate(d)).toBe(false)
			expect(temporalEngine.isValidCalendarDate(d)).toBe(false)
		}
	})

	it('parse/format round-trip agrees across engines', () => {
		for (const value of ['2026-08-05', '2024-02-29', '2026-12-31']) {
			expect(temporalEngine.parseDateInput(value)).toEqual(
				dateEngine.parseDateInput(value),
			)
		}
		for (const d of VALID) {
			expect(temporalEngine.formatDateInput(d)).toBe(
				dateEngine.formatDateInput(d),
			)
		}
	})
})

describe.each(engines)('%s engine — contract behavior', (_name, engine) => {
	it('resolveWeekend: Mon–Fri → the coming Sat..Sun', () => {
		// Wednesday 2026-08-12 → Saturday 15th, Sunday 16th.
		expect(engine.resolveWeekend({ year: 2026, month: 8, day: 12 })).toEqual({
			from: { year: 2026, month: 8, day: 15 },
			to: { year: 2026, month: 8, day: 16 },
		})
	})

	it('resolveWeekend: Saturday → today..tomorrow', () => {
		expect(engine.resolveWeekend({ year: 2026, month: 8, day: 15 })).toEqual({
			from: { year: 2026, month: 8, day: 15 },
			to: { year: 2026, month: 8, day: 16 },
		})
	})

	it('resolveWeekend: Sunday → single-day today range', () => {
		expect(engine.resolveWeekend({ year: 2026, month: 8, day: 16 })).toEqual({
			from: { year: 2026, month: 8, day: 16 },
			to: { year: 2026, month: 8, day: 16 },
		})
	})

	it('addDays crosses month and year boundaries', () => {
		expect(engine.addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
			year: 2027,
			month: 1,
			day: 1,
		})
		expect(engine.addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
			year: 2025,
			month: 12,
			day: 31,
		})
	})

	it('inclusiveDaySpan is 1 when equal, counts both bounds, and is signed', () => {
		const a = { year: 2026, month: 8, day: 12 }
		expect(engine.inclusiveDaySpan(a, a)).toBe(1)
		expect(engine.inclusiveDaySpan(a, { year: 2026, month: 8, day: 20 })).toBe(
			9,
		)
		// Inverted range stays < 1 so callers can use it as an order guard.
		expect(
			engine.inclusiveDaySpan({ year: 2026, month: 8, day: 20 }, a),
		).toBeLessThan(1)
	})

	it('todayCalendarDate returns a valid calendar date', () => {
		expect(engine.isValidCalendarDate(engine.todayCalendarDate())).toBe(true)
	})
})

it('a zero month is rejected, not silently rolled over (the footgun this closes)', () => {
	// Native Date rolls month 0 back into the previous December — the exact bug
	// that misbuckets a concert. Both engines must reject it instead.
	expect(new Date(2026, -1, 15).getFullYear()).toBe(2025)
	expect(
		dateEngine.isValidCalendarDate({ year: 2026, month: 0, day: 15 }),
	).toBe(false)
	expect(
		temporalEngine.isValidCalendarDate({ year: 2026, month: 0, day: 15 }),
	).toBe(false)
})
