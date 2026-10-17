/**
 * A time of day on a 24-hour clock, as the console enters it (design D19):
 * an hour from 00 to 23 and a minute in 5-minute steps. The texts are the
 * two-digit numbers themselves, never a locale's format, so no device setting
 * can bring AM or PM.
 */

/** A time split into its hour and minute, each two digits or '' when unset. */
export interface TimeParts {
	hour: string
	minute: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Hours 00 to 23. */
export const HOURS: readonly string[] = Array.from({ length: 24 }, (_, h) =>
	pad(h),
)

/** Minutes 00 to 55 in 5-minute steps. */
export const MINUTES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
	pad(i * 5),
)

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The parts of `HH:mm`, or both '' for '' or any other text. */
export function partsOf(value: string): TimeParts {
	const match = TIME.exec(value)
	return match ? { hour: match[1], minute: match[2] } : { hour: '', minute: '' }
}

/** `HH:mm` once both parts are chosen, otherwise ''. */
export function timeOf(parts: TimeParts): string {
	return parts.hour && parts.minute ? `${parts.hour}:${parts.minute}` : ''
}

/**
 * The minute choices: the 5-minute steps, plus `current` in its place when it
 * is off them (a time saved before the steps existed), so the field shows the
 * saved minute and keeps it until the member picks another.
 */
export function minuteChoices(current: string): readonly string[] {
	if (!current || MINUTES.includes(current)) return MINUTES
	return [...MINUTES, current].sort()
}
