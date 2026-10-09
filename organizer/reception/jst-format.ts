/**
 * Times on the reception and reception-links screens are shown in Japan time,
 * the time zone of every event's reception window, whatever the device's own
 * time zone is.
 */

const TIME_ZONE = 'Asia/Tokyo'

const PARTS = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
})

function parts(date: Date): Record<string, string> {
	const out: Record<string, string> = {}
	for (const p of PARTS.formatToParts(date)) out[p.type] = p.value
	return out
}

/** `18:32` in Japan time. */
export function formatJstTime(date: Date): string {
	const p = parts(date)
	return `${p.hour}:${p.minute}`
}

/** `2026-11-20 15:00` in Japan time. */
export function formatJstDateTime(date: Date): string {
	const p = parts(date)
	return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/** The label staff and the Organizer see for a link number: `受付1`. */
export function receptionLinkLabel(number: number): string {
	return `受付${number}`
}
