import {
	type WallClock,
	instantToWall,
	wallToInstant,
} from '../../shared/lib/zoned-time/zoned-time'

/**
 * `google.type.DateTime` and `google.type.TimeOfDay` in their Connect JSON
 * form (zero fields omitted by the server are accepted when sent).
 */
export interface WireDateTime {
	year: number
	month: number
	day: number
	hours?: number
	minutes?: number
	timeZone: { id: string }
}

/** A civil date-time in a zone, as the wire carries a sale's window. */
export function wireDateTime(wall: WallClock, zone: string): WireDateTime {
	return {
		year: wall.year,
		month: wall.month,
		day: wall.day,
		hours: wall.hour,
		minutes: wall.minute,
		timeZone: { id: zone },
	}
}

/** The DateTime that reads an instant in `zone` (Asia/Tokyo unless given). */
export function wireDateTimeAt(
	instant: string | number | Date,
	zone = 'Asia/Tokyo',
): WireDateTime {
	return wireDateTime(instantToWall(new Date(instant), zone), zone)
}

/** The instant of a wire DateTime, as RFC 3339. */
export function wireInstant(dt: WireDateTime): string {
	const instant = wallToInstant(
		{
			year: dt.year,
			month: dt.month,
			day: dt.day,
			hour: dt.hours ?? 0,
			minute: dt.minutes ?? 0,
		},
		dt.timeZone.id,
	)
	if (!instant) throw new Error(`no such time: ${JSON.stringify(dt)}`)
	return instant.toISOString()
}

/** A `{ value: TimeOfDay }` wrapper for an `HH:mm` time. */
export function wireTime(hhmm: string) {
	const [hours, minutes] = hhmm.split(':').map(Number)
	return { value: { hours, minutes } }
}
