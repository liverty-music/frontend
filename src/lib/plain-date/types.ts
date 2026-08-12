/**
 * Boundary types for the plain-date library. Every value that crosses the
 * library interface — argument or return — is one of these plain data shapes
 * or a primitive; no engine-specific temporal object (native `Date` or
 * `Temporal.PlainDate`) ever appears in a signature. This is what makes the
 * `Date` and `Temporal` engines interchangeable behind the same interface.
 *
 * See OpenSpec `introduce-swappable-plain-date-lib` — capability
 * `frontend-plain-date-lib`.
 */

// The single source of truth for the calendar-date shape is the RPC client type
// (mirrors `google.type.Date` / `entity.v1.LocalDate`). Re-export it so the
// whole library and its consumers speak one `CalendarDate`.
export type { CalendarDate } from '../../adapter/rpc/client/concert-client'

import type { CalendarDate } from '../../adapter/rpc/client/concert-client'

/** A resolved calendar-date range, both bounds inclusive. */
export interface DateRange {
	from: CalendarDate
	to: CalendarDate
}

/**
 * The fixed calendar-arithmetic contract every engine implements. The two
 * engines (`date-impl`, `temporal-impl`) each `satisfies CalendarDateEngine`
 * so a signature drift between them is a compile error, and the shared
 * differential test proves they agree at runtime too.
 */
export interface CalendarDateEngine {
	/** Today's date from local wall-clock components (never UTC). */
	todayCalendarDate(): CalendarDate
	/** Add `days` (may be negative) to `date`, returning a new value. Pure. */
	addDays(date: CalendarDate, days: number): CalendarDate
	/**
	 * Resolve the weekend range relative to `base`:
	 * Mon–Fri → the coming Sat..Sun; Sat → today..tomorrow; Sun → today..today.
	 */
	resolveWeekend(base: CalendarDate): DateRange
	/** Inclusive whole-day span from `from` to `to` (1 when equal; signed). */
	inclusiveDaySpan(from: CalendarDate, to: CalendarDate): number
	/**
	 * Whether `date` denotes a real calendar day. Unlike {@link parseDateInput}'s
	 * lenient field check, this rejects impossible days (e.g. Feb 30) and the
	 * zero/out-of-domain components that native `Date` would silently roll over.
	 */
	isValidCalendarDate(date: CalendarDate): boolean
	/** Parse a "YYYY-MM-DD" value; `null` when empty or malformed. */
	parseDateInput(value: string): CalendarDate | null
	/** Serialize to a zero-padded "YYYY-MM-DD" value. */
	formatDateInput(date: CalendarDate): string
}
