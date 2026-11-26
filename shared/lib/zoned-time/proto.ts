import { type WallClock, wallToInstant } from './zoned-time'

/**
 * `google.type.DateTime` and `google.type.TimeOfDay` as the apps read and write
 * them, without importing the generated Google types (they are not a direct
 * dependency): a structural view of the fields used.
 */

export interface TimeOfDayLike {
	readonly hours: number
	readonly minutes: number
}

export interface DateTimeLike {
	readonly year: number
	readonly month: number
	readonly day: number
	readonly hours: number
	readonly minutes: number
	readonly timeOffset:
		| { readonly case: 'timeZone'; readonly value: { readonly id: string } }
		| {
				readonly case: 'utcOffset'
				readonly value: { readonly seconds: bigint }
		  }
		| { readonly case: undefined; readonly value?: undefined }
}

/** The civil date-time of a DateTime, to the minute. */
export function wallOfDateTime(dt: DateTimeLike): WallClock {
	return {
		year: dt.year,
		month: dt.month,
		day: dt.day,
		hour: dt.hours,
		minute: dt.minutes,
	}
}

/** The IANA zone a DateTime names, or undefined when it carries a UTC offset or none. */
export function zoneOfDateTime(dt: DateTimeLike): string | undefined {
	return dt.timeOffset.case === 'timeZone' ? dt.timeOffset.value.id : undefined
}

/**
 * The instant of a DateTime: its civil date-time read in its zone (or at its
 * UTC offset). Undefined when the zone is unknown or the time does not exist
 * in it.
 */
export function instantOfDateTime(dt: DateTimeLike): Date | undefined {
	const wall = wallOfDateTime(dt)
	if (dt.timeOffset.case === 'timeZone') {
		return wallToInstant(wall, dt.timeOffset.value.id)
	}
	const offsetMs =
		dt.timeOffset.case === 'utcOffset'
			? Number(dt.timeOffset.value.seconds) * 1000
			: 0
	return new Date(
		Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) -
			offsetMs,
	)
}

/** A DateTime message init for a civil date-time in an IANA zone. */
export function dateTimeInit(wall: WallClock, zone: string) {
	return {
		year: wall.year,
		month: wall.month,
		day: wall.day,
		hours: wall.hour,
		minutes: wall.minute,
		seconds: 0,
		nanos: 0,
		timeOffset: { case: 'timeZone' as const, value: { id: zone, version: '' } },
	}
}

/** A TimeOfDay message init for a time of day to the minute. */
export function timeOfDayInit(time: { hour: number; minute: number }) {
	return { hours: time.hour, minutes: time.minute, seconds: 0, nanos: 0 }
}
