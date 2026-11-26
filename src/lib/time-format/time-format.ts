import {
	type DisplayLanguage,
	displayLanguage,
	zoneLabel,
} from '../../../shared/lib/zoned-time/zone-name'
import {
	convertWall,
	formatDayTime,
	formatTime,
	otherZoneReading,
	sameOffsetAt,
} from '../../../shared/lib/zoned-time/format'
import {
	type WallClock,
	type WallTime,
	dateKey,
	instantToWall,
	viewerZone,
	wallToInstant,
} from '../../../shared/lib/zoned-time/zoned-time'

/**
 * Every date and time the fan app shows, in the zone it belongs to:
 *
 * - an Event's times, at its Venue's local time, with the viewer's own time in
 *   parentheses when the viewer's zone is at another offset at that moment;
 * - a TicketSale's window, in the viewer's zone, named when it is not the
 *   sale's zone;
 * - a moment in the past, in the viewer's zone, with no name.
 *
 * Nothing here reads a constant zone: the Venue's and the sale's zones come
 * from the responses, and the viewer's from the browser (`viewerZone`).
 */

export type { DisplayLanguage }
export { displayLanguage, viewerZone }

/** A calendar date. */
export interface CivilDate {
	readonly year: number
	readonly month: number
	readonly day: number
}

/** The wall-clock times of one Event, read in its Venue's zone. */
export interface EventClock {
	/** The calendar date at the Venue. */
	readonly date: CivilDate
	readonly open?: WallTime
	readonly start?: WallTime
	/** The Venue's IANA zone; absent for a Venue stored before zones were recorded. */
	readonly timeZone?: string
}

/** What an Event's times look like on a screen. */
export interface EventTimesText {
	/** The open time at the Venue (`18:30`), or ''. */
	readonly open: string
	/** The start time at the Venue, or ''. */
	readonly start: string
	/**
	 * The Venue zone's name, and the viewer's times in parentheses, shown once
	 * after the times (`ロンドン時間（日本時間 2月21日(日) 03:30 / 04:30）`);
	 * '' when the viewer's zone has the Venue's offset or the Venue has no zone.
	 */
	readonly zone: string
}

const wallOf = (date: CivilDate, time: WallTime): WallClock => ({
	year: date.year,
	month: date.month,
	day: date.day,
	hour: time.hour,
	minute: time.minute,
})

function parenthesize(text: string, lang: DisplayLanguage): string {
	return lang === 'ja' ? `（${text}）` : ` (${text})`
}

/**
 * The text that follows an Event's moment: the Venue zone's name and, in
 * parentheses, the viewer's time, when the viewer's zone has another offset
 * at that moment. `times` are the moments written, in order.
 */
function zoneSuffix(
	date: CivilDate,
	times: readonly WallTime[],
	zone: string | undefined,
	lang: DisplayLanguage,
	viewer: string,
): string {
	if (!zone || times.length === 0) return ''
	const differs = times.some(
		(t) => !sameOffsetAt(wallOf(date, t), zone, viewer),
	)
	if (!differs) return ''
	let previous: CivilDate = date
	const readings: string[] = []
	for (const t of times) {
		const other = convertWall(wallOf(date, t), zone, viewer)
		if (!other) continue
		readings.push(otherZoneReading(previous, other, lang))
		previous = other
	}
	if (readings.length === 0) return zoneLabel(zone, lang)
	return `${zoneLabel(zone, lang)}${parenthesize(`${zoneLabel(viewer, lang)} ${readings.join(' / ')}`, lang)}`
}

/** The open and start times of an Event, and the zone text that follows them. */
export function formatEventTimes(
	clock: EventClock,
	lang: DisplayLanguage,
	viewer: string = viewerZone(),
): EventTimesText {
	const times = [clock.open, clock.start].filter(
		(t): t is WallTime => t !== undefined,
	)
	return {
		open: clock.open ? formatTime(clock.open) : '',
		start: clock.start ? formatTime(clock.start) : '',
		zone: zoneSuffix(clock.date, times, clock.timeZone, lang, viewer),
	}
}

/**
 * One moment at a Venue with its date: `2月20日(土) 19:30 ロンドン時間（日本時間
 * 2月21日(日) 04:30）`. The zone text is left out when the viewer's zone has the
 * Venue's offset.
 */
export function formatEventMoment(
	date: CivilDate,
	time: WallTime,
	zone: string | undefined,
	lang: DisplayLanguage,
	viewer: string = viewerZone(),
): string {
	const text = formatDayTime(wallOf(date, time), lang)
	const suffix = zoneSuffix(date, [time], zone, lang, viewer)
	if (!suffix) return text
	// A parenthesis follows the zone name directly in Japanese.
	return `${text} ${suffix.replace(/^ /, '')}`
}

/** The date of an Event with its weekday and year: `2026年11月20日(金)`. */
export function formatEventDay(date: CivilDate, lang: DisplayLanguage): string {
	return new Intl.DateTimeFormat(lang, {
		timeZone: 'UTC',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		weekday: 'short',
	}).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)))
}

/** The short date of a tab: `11/20(金)` / `11/20 Fri`. */
export function formatTabDay(date: CivilDate, lang: DisplayLanguage): string {
	return new Intl.DateTimeFormat(lang, {
		timeZone: 'UTC',
		month: 'numeric',
		day: 'numeric',
		weekday: 'short',
	}).format(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)))
}

/**
 * A moment of a TicketSale in the viewer's zone, named when the viewer's zone
 * is not the sale's: `2月1日(月) 13:00 日本時間`.
 */
export function formatSaleMoment(
	instant: Date,
	saleZone: string | undefined,
	lang: DisplayLanguage,
	viewer: string = viewerZone(),
): string {
	const text = formatDayTime(instantToWall(instant, viewer), lang)
	return saleZone && saleZone !== viewer
		? `${text} ${zoneLabel(viewer, lang)}`
		: text
}

/** A moment in the past (an admission, a refund) in the viewer's zone, with no name. */
export function formatPastMoment(
	instant: Date,
	lang: DisplayLanguage,
	viewer: string = viewerZone(),
): string {
	return formatDayTime(instantToWall(instant, viewer), lang)
}

/**
 * A moment of an instant at a Venue, as `formatEventMoment` writes it. A Venue
 * without a zone reads in the viewer's zone, with no label.
 */
export function formatInstantAtVenue(
	instant: Date,
	zone: string | undefined,
	lang: DisplayLanguage,
	viewer: string = viewerZone(),
): string {
	const wall = instantToWall(instant, zone ?? viewer)
	return formatEventMoment(wall, wall, zone, lang, viewer)
}

/** The instant an Event's time occurs, or undefined without a zone or in a skipped hour. */
export function eventInstant(
	clock: EventClock,
	time: WallTime | undefined,
): Date | undefined {
	if (!time || !clock.timeZone) return undefined
	return wallToInstant(wallOf(clock.date, time), clock.timeZone)
}

/** The date `YYYY-MM-DD` of an Event's civil date. */
export function eventDateKey(date: CivilDate): string {
	return dateKey(date)
}

/** UTC−12, the last zone to see a date: the zone of a Venue whose zone is unknown. */
const LAST_ZONE = 'Etc/GMT+12'

/**
 * Today's date at a Venue; the earliest date anywhere when the Venue's zone
 * is unknown, so an Event is never called past too early.
 */
export function todayAtVenue(
	zone: string | undefined,
	now: Date = new Date(),
): string {
	return dateKey(instantToWall(now, zone ?? LAST_ZONE))
}

/** The viewer's calendar date, for the timetable's date picker. */
export function viewerToday(now: Date = new Date()): CivilDate {
	const w = instantToWall(now, viewerZone())
	return { year: w.year, month: w.month, day: w.day }
}
