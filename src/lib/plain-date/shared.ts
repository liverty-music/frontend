/**
 * Engine-independent plain-date operations. These touch neither `Date` nor
 * `Temporal` — they are pure string/field transforms — so both engines share
 * one implementation rather than duplicating it. Each engine re-exports these
 * so the full contract is available from either engine module.
 */
import type { CalendarDate } from './types'

/**
 * Parse an `<input type="date">` value ("YYYY-MM-DD") into a {@link CalendarDate}.
 * Returns `null` for an empty or malformed value. Domain-checks the month
 * (1–12) and day (1–31) fields; it does NOT reject impossible day-of-month
 * combinations (e.g. 2026-02-31) — that stricter check is
 * {@link CalendarDateEngine.isValidCalendarDate}, which the two engines back
 * differently.
 */
export function parseDateInput(value: string): CalendarDate | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
	if (!match) return null
	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	if (month < 1 || month > 12 || day < 1 || day > 31) return null
	return { year, month, day }
}

/** Serialize a {@link CalendarDate} into an `<input type="date">` value. */
export function formatDateInput(date: CalendarDate): string {
	const month = String(date.month).padStart(2, '0')
	const day = String(date.day).padStart(2, '0')
	return `${date.year}-${month}-${day}`
}
