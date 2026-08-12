import {
	addDays,
	type CalendarDate,
	type DateRange,
	formatDateInput,
	inclusiveDaySpan,
	parseDateInput,
	resolveWeekend,
	todayCalendarDate,
} from '../../lib/plain-date'

// Pure calendar arithmetic now lives in the engine-agnostic `lib/plain-date`
// (OpenSpec `introduce-swappable-plain-date-lib`). This module keeps only the
// All-Nearby-specific glue — preset ids, the range/cache shapes, and the Intl
// display formatting — and re-exports the primitives its consumers
// (date-range-sheet, dashboard-route) already import from here.
export {
	type CalendarDate,
	type DateRange,
	formatDateInput,
	inclusiveDaySpan,
	parseDateInput,
}

/**
 * The three quick presets for the All Nearby discovery filter. A custom range is
 * no longer a preset — it is entered through the date-range sheet's date inputs,
 * so `custom` is not part of this union.
 */
export type DatePresetId = 'weekend' | 'week' | 'month'

/** Maximum span (inclusive days) a custom range may cover. */
export const MAX_RANGE_DAYS = 30

/**
 * Resolve a preset id into an inclusive `{ from, to }` range, relative to
 * `today` (defaults to the current local date).
 *
 * Weekend rule (local time):
 *   - Mon–Fri → the coming Sat..Sun.
 *   - Sat     → today (Sat)..tomorrow (Sun).
 *   - Sun     → today..today.
 */
export function resolvePreset(
	preset: DatePresetId,
	today: CalendarDate = todayCalendarDate(),
): DateRange | null {
	switch (preset) {
		case 'weekend':
			return resolveWeekend(today)
		case 'week':
			return { from: today, to: addDays(today, 6) }
		case 'month':
			return { from: today, to: addDays(today, MAX_RANGE_DAYS - 1) }
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
	today: CalendarDate = todayCalendarDate(),
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

/** Build a stable cache key for a resolved range + area. */
export function rangeCacheKey(
	adminArea: string,
	from: CalendarDate,
	to: CalendarDate,
): string {
	return `${adminArea}|${formatDateInput(from)}|${formatDateInput(to)}`
}
