import type { CalendarDate } from '../../adapter/rpc/client/concert-client'

/**
 * The three quick presets for the All Nearby discovery filter. A custom range is
 * no longer a preset — it is entered through the date-range sheet's date inputs,
 * so `custom` is not part of this union.
 */
export type DatePresetId = 'weekend' | 'week' | 'month'

/** A resolved date range, both bounds inclusive. */
export interface DateRange {
	from: CalendarDate
	to: CalendarDate
}

/** Maximum span (inclusive days) a custom range may cover. */
export const MAX_RANGE_DAYS = 30

/**
 * Convert a local `Date` into a {@link CalendarDate} using its LOCAL components
 * (never UTC) so the range the user sees matches the range sent to the backend
 * regardless of timezone.
 */
export function toCalendarDate(d: Date): CalendarDate {
	return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** Add `days` to a local `Date`, returning a new `Date` (no mutation). */
function addDays(d: Date, days: number): Date {
	const next = new Date(d.getFullYear(), d.getMonth(), d.getDate())
	next.setDate(next.getDate() + days)
	return next
}

/**
 * Resolve a preset id into an inclusive `{ from, to }` range, relative to
 * `today` (defaults to the current local date). `custom` is not resolvable here
 * — the caller owns the explicit from/to inputs — so it returns `null`.
 *
 * Weekend rule (local time):
 *   - Mon–Fri → the coming Sat..Sun.
 *   - Sat     → today (Sat)..tomorrow (Sun).
 *   - Sun     → today..today.
 */
export function resolvePreset(
	preset: DatePresetId,
	today: Date = new Date(),
): DateRange | null {
	// Normalize to midnight-local so arithmetic never drifts on DST edges.
	const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
	switch (preset) {
		case 'weekend':
			return resolveWeekend(base)
		case 'week':
			return {
				from: toCalendarDate(base),
				to: toCalendarDate(addDays(base, 6)),
			}
		case 'month':
			return {
				from: toCalendarDate(base),
				to: toCalendarDate(addDays(base, MAX_RANGE_DAYS - 1)),
			}
	}
}

/**
 * Localize a {@link CalendarDate} range for display on the date chip / sheet
 * header — always via `Intl.DateTimeFormat`, never the native input's format.
 * A single day (from === to) renders as one localized day; otherwise the two
 * localized days are joined with a wave dash (e.g. `8/12〜8/20`).
 */
export function formatRangeLabel(range: DateRange, locale = 'ja-JP'): string {
	const fmt = new Intl.DateTimeFormat(locale, {
		month: 'numeric',
		day: 'numeric',
	})
	const from = fmt.format(
		new Date(range.from.year, range.from.month - 1, range.from.day),
	)
	if (inclusiveDaySpan(range.from, range.to) <= 1) {
		return from
	}
	const to = fmt.format(
		new Date(range.to.year, range.to.month - 1, range.to.day),
	)
	return `${from}〜${to}`
}

/**
 * Compare two {@link CalendarDate} values for equality by their calendar fields.
 * Used to decide whether the current range matches a preset (so the chip can
 * show the preset name instead of a raw range).
 */
export function calendarDatesEqual(a: CalendarDate, b: CalendarDate): boolean {
	return a.year === b.year && a.month === b.month && a.day === b.day
}

/**
 * Identify which preset (if any) a resolved range currently matches, relative to
 * `today`. Returns the preset id when both bounds match a preset's resolved
 * range, else `null` (the range is custom).
 */
export function matchPreset(
	range: DateRange,
	today: Date = new Date(),
): DatePresetId | null {
	const presets: DatePresetId[] = ['weekend', 'week', 'month']
	for (const id of presets) {
		const resolved = resolvePreset(id, today)
		if (
			resolved &&
			calendarDatesEqual(resolved.from, range.from) &&
			calendarDatesEqual(resolved.to, range.to)
		) {
			return id
		}
	}
	return null
}

/** Resolve the "this weekend" range from a midnight-local base date. */
function resolveWeekend(base: Date): DateRange {
	const day = base.getDay() // 0 = Sun, 6 = Sat
	if (day === 0) {
		// Sunday: the weekend is effectively over — single-day today range.
		return { from: toCalendarDate(base), to: toCalendarDate(base) }
	}
	if (day === 6) {
		// Saturday: today (Sat) through tomorrow (Sun).
		return { from: toCalendarDate(base), to: toCalendarDate(addDays(base, 1)) }
	}
	// Mon–Fri: jump forward to the coming Saturday, then +1 for Sunday.
	const daysUntilSaturday = 6 - day
	const saturday = addDays(base, daysUntilSaturday)
	return {
		from: toCalendarDate(saturday),
		to: toCalendarDate(addDays(saturday, 1)),
	}
}

/**
 * Parse an `<input type="date">` value ("YYYY-MM-DD") into a {@link CalendarDate}.
 * Returns `null` for an empty or malformed value.
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

/** Whole-day span from `from` to `to`, inclusive (1 when equal). */
export function inclusiveDaySpan(from: CalendarDate, to: CalendarDate): number {
	const fromMs = Date.UTC(from.year, from.month - 1, from.day)
	const toMs = Date.UTC(to.year, to.month - 1, to.day)
	return Math.floor((toMs - fromMs) / 86_400_000) + 1
}

/** Build a stable cache key for a resolved range + area. */
export function rangeCacheKey(
	adminArea: string,
	from: CalendarDate,
	to: CalendarDate,
): string {
	return `${adminArea}|${formatDateInput(from)}|${formatDateInput(to)}`
}
