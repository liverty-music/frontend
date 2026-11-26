import { type DisplayLanguage, zoneLabel } from './zone-name'
import {
	type WallClock,
	type WallTime,
	instantToWall,
	offsetMsAt,
	timeKey,
	wallToInstant,
} from './zoned-time'

/**
 * Pieces of a time shown in a zone, for the fan app's and the organizer
 * console's formatting modules. The pieces never touch the device's time zone:
 * a civil date is formatted in UTC, which only keeps `Intl` from shifting it.
 */

const dayFormats = new Map<string, Intl.DateTimeFormat>()

function dayFormat(lang: DisplayLanguage, weekday: boolean, year: boolean) {
	const key = `${lang}:${weekday}:${year}`
	let f = dayFormats.get(key)
	if (!f) {
		f = new Intl.DateTimeFormat(lang, {
			timeZone: 'UTC',
			...(year ? { year: 'numeric' as const } : {}),
			month: lang === 'ja' ? 'long' : 'short',
			day: 'numeric',
			...(weekday ? { weekday: 'short' as const } : {}),
		})
		dayFormats.set(key, f)
	}
	return f
}

/** A civil date: `2月20日(土)` / `Sat, Feb 20`, with the weekday unless `weekday` is false. */
export function formatDay(
	date: Pick<WallClock, 'year' | 'month' | 'day'>,
	lang: DisplayLanguage,
	options: { weekday?: boolean; year?: boolean } = {},
): string {
	return dayFormat(lang, options.weekday ?? true, options.year ?? false).format(
		new Date(Date.UTC(date.year, date.month - 1, date.day, 12)),
	)
}

/** A time of day on a 24-hour clock: `19:30`, in every language. */
export function formatTime(time: WallTime): string {
	return timeKey(time)
}

/** A civil date and time: `2月20日(土) 19:30` / `Sat, Feb 20, 19:30`. */
export function formatDayTime(
	wall: WallClock,
	lang: DisplayLanguage,
	options: { weekday?: boolean; year?: boolean } = {},
): string {
	const day = formatDay(wall, lang, options)
	return lang === 'ja'
		? `${day} ${formatTime(wall)}`
		: `${day}, ${formatTime(wall)}`
}

/** The same moment on another zone's clocks, or undefined when `wall` does not exist in `zone`. */
export function convertWall(
	wall: WallClock,
	zone: string,
	toZone: string,
): WallClock | undefined {
	const instant = wallToInstant(wall, zone)
	return instant ? instantToWall(instant, toZone) : undefined
}

/** True when both zones are the same distance from UTC at the moment of `wall` in `zone`. */
export function sameOffsetAt(
	wall: WallClock,
	zone: string,
	otherZone: string,
): boolean {
	const instant = wallToInstant(wall, zone)
	if (!instant) return zone === otherZone
	return offsetMsAt(instant, zone) === offsetMsAt(instant, otherZone)
}

/** The label of a zone with the display language's suffix: `日本時間`. */
export { zoneLabel }

/** True when two civil dates are the same day. */
export function sameDay(
	a: Pick<WallClock, 'year' | 'month' | 'day'>,
	b: Pick<WallClock, 'year' | 'month' | 'day'>,
): boolean {
	return a.year === b.year && a.month === b.month && a.day === b.day
}

/**
 * The other zone's reading of a moment, written for the parenthesis after a
 * zone label: `日本時間 2月21日(日) 04:30` / `Japan time Feb 21, 04:30`. The
 * date is written only when it differs from `base`'s.
 */
export function formatOtherZoneMoment(
	base: Pick<WallClock, 'year' | 'month' | 'day'>,
	other: WallClock,
	otherZone: string,
	lang: DisplayLanguage,
): string {
	return `${zoneLabel(otherZone, lang)} ${otherZoneReading(base, other, lang)}`
}

/** `2月21日(日) 04:30` when the date differs from `base`'s, `04:30` otherwise. */
export function otherZoneReading(
	base: Pick<WallClock, 'year' | 'month' | 'day'>,
	other: WallClock,
	lang: DisplayLanguage,
): string {
	if (sameDay(base, other)) return formatTime(other)
	// Japanese keeps the weekday of the other date; English reads shorter without it.
	return formatDayTime(other, lang, { weekday: lang === 'ja' })
}
