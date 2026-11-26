import {
	type WallClock,
	isCalendarWall,
	parseDateKey,
	parseTimeKey,
	wallToInstant,
} from '../../shared/lib/zoned-time/zoned-time'

/**
 * A wall-clock date and time as the console enters them: a date field
 * (`YYYY-MM-DD`) and a 24-hour time field (`HH:mm`), each '' while unset. The
 * zone they are read in is not part of the value: it belongs to the field
 * (an Event's Venue, a sale's time zone).
 */
export interface DateTimeInput {
	date: string
	time: string
}

/** An unset date and time. */
export function emptyDateTimeInput(): DateTimeInput {
	return { date: '', time: '' }
}

/** The date and time fields showing a civil date-time. */
export function toDateTimeInput(wall: WallClock): DateTimeInput {
	const pad = (n: number) => String(n).padStart(2, '0')
	return {
		date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`,
		time: `${pad(wall.hour)}:${pad(wall.minute)}`,
	}
}

/** The civil date-time the fields name, or undefined when either is unset or malformed. */
export function wallOfInput(value: DateTimeInput): WallClock | undefined {
	const date = parseDateKey(value.date.trim())
	const time = parseTimeKey(value.time.trim())
	if (!date || !time) return undefined
	const wall = { ...date, ...time }
	return isCalendarWall(wall) ? wall : undefined
}

/** The instant the fields name in `zone`, or undefined when unset, malformed or skipped by the clocks. */
export function instantOfInput(
	value: DateTimeInput,
	zone: string,
): Date | undefined {
	const wall = wallOfInput(value)
	return wall ? wallToInstant(wall, zone) : undefined
}

/**
 * The part of `value` that keeps it from being a civil date-time, the date
 * first: 'date' while the date is unset or not a calendar day, 'time' while
 * the time is unset or malformed, null once both read.
 */
export function unsetPartOf(value: DateTimeInput): 'date' | 'time' | null {
	if (!parseDateKey(value.date.trim())) return 'date'
	if (!parseTimeKey(value.time.trim())) return 'time'
	return null
}

/** True when both parts are the same. */
export function sameDateTimeInput(a: DateTimeInput, b: DateTimeInput): boolean {
	return a.date === b.date && a.time === b.time
}
