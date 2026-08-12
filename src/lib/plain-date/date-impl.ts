/**
 * Native `Date`-backed implementation of the plain-date contract. This is the
 * engine shipped in production today (Vite `resolve.alias` default). All
 * arithmetic works on local calendar components — there is no wall-clock time
 * at the boundary, so `Date`'s DST hazards never arise here.
 *
 * When TC39 `Temporal` reaches Baseline, flip the alias default to
 * `temporal-impl` (proven equivalent by `plain-date.spec.ts`) and drop this
 * file. See OpenSpec `introduce-swappable-plain-date-lib`.
 */
import { formatDateInput, parseDateInput } from './shared'
import type { CalendarDate, CalendarDateEngine, DateRange } from './types'

/** Build a `CalendarDate` from a `Date`'s LOCAL components (1-based month). */
function fromDate(d: Date): CalendarDate {
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** Interpret a `CalendarDate` as a local midnight `Date` for arithmetic. */
function toDate(d: CalendarDate): Date {
	return new Date(d.year, d.month - 1, d.day)
}

export function todayCalendarDate(): CalendarDate {
	return fromDate(new Date())
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
	const d = toDate(date)
	d.setDate(d.getDate() + days)
	return fromDate(d)
}

export function resolveWeekend(base: CalendarDate): DateRange {
	const day = toDate(base).getDay() // 0 = Sun, 6 = Sat
	if (day === 0) {
		// Sunday: the weekend is effectively over — single-day today range.
		return { from: base, to: base }
	}
	if (day === 6) {
		// Saturday: today (Sat) through tomorrow (Sun).
		return { from: base, to: addDays(base, 1) }
	}
	// Mon–Fri: jump forward to the coming Saturday, then +1 for Sunday.
	const saturday = addDays(base, 6 - day)
	return { from: saturday, to: addDays(saturday, 1) }
}

export function inclusiveDaySpan(from: CalendarDate, to: CalendarDate): number {
	// UTC epochs avoid any DST offset between the two local midnights.
	const fromMs = Date.UTC(from.year, from.month - 1, from.day)
	const toMs = Date.UTC(to.year, to.month - 1, to.day)
	return Math.floor((toMs - fromMs) / 86_400_000) + 1
}

export function isValidCalendarDate(date: CalendarDate): boolean {
	const { year, month, day } = date
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day)
	) {
		return false
	}
	// Reject the two-digit-year window (`new Date(50, …)` → 1950) so this engine
	// agrees with Temporal on 4-digit domain years; our dates are always 4-digit.
	if (year < 100) return false
	// Round-trip through `Date`: any silent rollover (month 0, Feb 31, …) changes
	// a component, so a field mismatch means the input was not a real day.
	const d = new Date(year, month - 1, day)
	return (
		d.getFullYear() === year &&
		d.getMonth() === month - 1 &&
		d.getDate() === day
	)
}

export { formatDateInput, parseDateInput }

/**
 * The engine as one object, typed against the contract. Its `CalendarDateEngine`
 * annotation is the compile-time guard that this module implements every
 * operation with the right signature — a drift from `temporal-impl` fails
 * `tsc`. Consumers normally import the named functions instead.
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
