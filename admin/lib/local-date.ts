/** Shown in admin rows for a value the response does not carry. */
export const EMPTY = '—'

/**
 * Formats a google.type.Date (a plain year, month and day, no timezone) as
 * YYYY-MM-DD, so admin rows read and sort the same in every locale.
 */
export function formatDateValue(d?: {
	year: number
	month: number
	day: number
}): string {
	if (!d) return EMPTY
	const mm = String(d.month).padStart(2, '0')
	const dd = String(d.day).padStart(2, '0')
	return `${d.year}-${mm}-${dd}`
}
