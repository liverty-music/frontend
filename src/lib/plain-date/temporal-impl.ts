/**
 * TC39 `Temporal`-backed implementation of the plain-date contract. Behaviorally
 * identical to `date-impl` (proven by `plain-date.spec.ts`), but built on
 * `Temporal.PlainDate` — an immutable, timezone-free civil date that removes
 * the native-`Date` footguns (silent month rollover, month-0 indexing).
 *
 * This engine is NOT shipped yet: `Temporal` is ES2026 but not Baseline
 * (Safari ships it only in Technology Preview), and its polyfill is ~44 KB
 * gzipped. It references `globalThis.Temporal` and deliberately does NOT import
 * `@js-temporal/polyfill` — the polyfill is a test-only dependency installed on
 * `globalThis` by the differential suite. Once `Temporal` is Baseline, flip the
 * Vite alias default to this file (native, +0 KB). See OpenSpec
 * `introduce-swappable-plain-date-lib`.
 */
import { formatDateInput, parseDateInput } from './shared'
import type { CalendarDate, CalendarDateEngine, DateRange } from './types'

// Minimal ambient typing for the subset of the Temporal API this engine uses.
// The platform (and the test-only polyfill) provide the full types at runtime;
// declaring just the surface we consume keeps the engine free of any polyfill
// import, as the spec requires.
interface PlainDate {
	readonly year: number
	readonly month: number
	readonly day: number
	/** ISO day of week: 1 = Monday … 7 = Sunday. */
	readonly dayOfWeek: number
	add(duration: { days?: number }): PlainDate
	until(other: PlainDate, options?: { largestUnit?: 'day' }): { days: number }
}
interface TemporalNamespace {
	PlainDate: {
		from(
			item: { year: number; month: number; day: number },
			options?: { overflow?: 'constrain' | 'reject' },
		): PlainDate
	}
	Now: { plainDateISO(): PlainDate }
}
declare global {
	var Temporal: TemporalNamespace
}

/** Convert a `PlainDate` back to the boundary `CalendarDate` shape. */
function fromPlain(pd: PlainDate): CalendarDate {
	return { year: pd.year, month: pd.month, day: pd.day }
}

/**
 * Interpret a `CalendarDate` as a `PlainDate`. `overflow: 'reject'` makes an
 * out-of-domain component (month 0, Feb 31, …) throw instead of being clamped,
 * which is how invalid input is surfaced rather than silently rolled over.
 */
function toPlain(d: CalendarDate): PlainDate {
	return globalThis.Temporal.PlainDate.from(
		{ year: d.year, month: d.month, day: d.day },
		{ overflow: 'reject' },
	)
}

export function todayCalendarDate(): CalendarDate {
	return fromPlain(globalThis.Temporal.Now.plainDateISO())
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
	return fromPlain(toPlain(date).add({ days }))
}

export function resolveWeekend(base: CalendarDate): DateRange {
	const dow = toPlain(base).dayOfWeek // 1 = Mon … 6 = Sat, 7 = Sun
	if (dow === 7) {
		// Sunday: the weekend is effectively over — single-day today range.
		return { from: base, to: base }
	}
	if (dow === 6) {
		// Saturday: today (Sat) through tomorrow (Sun).
		return { from: base, to: addDays(base, 1) }
	}
	// Mon–Fri: jump forward to the coming Saturday, then +1 for Sunday.
	const saturday = addDays(base, 6 - dow)
	return { from: saturday, to: addDays(saturday, 1) }
}

export function inclusiveDaySpan(from: CalendarDate, to: CalendarDate): number {
	// `until` returns a signed day count; +1 makes it inclusive, and stays
	// negative for an inverted range (drives the caller's order guard).
	return toPlain(from).until(toPlain(to), { largestUnit: 'day' }).days + 1
}

export function isValidCalendarDate(date: CalendarDate): boolean {
	if (
		!Number.isInteger(date.year) ||
		!Number.isInteger(date.month) ||
		!Number.isInteger(date.day)
	) {
		return false
	}
	try {
		toPlain(date)
		return true
	} catch {
		// PlainDate.from with overflow:'reject' throws RangeError on any
		// impossible component.
		return false
	}
}

export { formatDateInput, parseDateInput }

/**
 * The engine as one object, typed against the contract — the compile-time guard
 * that this module stays signature-identical to `date-impl`. Consumers normally
 * import the named functions instead.
 */
export const engine: CalendarDateEngine = {
	todayCalendarDate,
	addDays,
	resolveWeekend,
	inclusiveDaySpan,
	isValidCalendarDate,
	parseDateInput,
	formatDateInput,
}
