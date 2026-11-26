/**
 * Times in the zone they belong to, yen and counts for the organizer console.
 *
 * An Event's date and times are the wall clock at its Venue (read in the
 * Venue's zone); a TicketSale's window is a civil date-time in the sale's
 * zone; a moment in the past about an event reads in the Venue's zone. Every
 * value is labelled with its zone's name (`ロンドン時間`, `London time`), and a
 * Venue outside Japan also gets Japan time in parentheses, so a member
 * announcing a show abroad to fans in Japan sees both. Nothing here reads the
 * device's time zone.
 */
import {
	convertWall,
	formatDay,
	formatDayTime,
	otherZoneReading,
	zoneLabel,
} from '../../shared/lib/zoned-time/format'
import {
	type WallClock,
	type WallTime,
	instantToWall,
} from '../../shared/lib/zoned-time/zoned-time'

export type ConsoleLocale = 'ja' | 'en'

/**
 * Japan time, which the console writes in parentheses after the time of an
 * Event in any other zone, because the fans an Organizer announces to are in
 * Japan (components/infrastructure/organizer/web/global/i18n "Dates and times
 * in the zone they belong to"). It is the one zone the console names itself;
 * every other zone comes from a response.
 */
export const JAPAN_TIME_ZONE = 'Asia/Tokyo'

/** A calendar date. */
export interface CivilDate {
	readonly year: number
	readonly month: number
	readonly day: number
}

/** An Event's date, its start time when set, and its Venue's zone. */
export interface EventWhen {
	readonly date: CivilDate
	readonly time?: WallTime
	/** The Venue's IANA zone; absent for a Venue that has none. */
	readonly zone?: string
}

/** A TicketSale's window: civil date-times in the sale's zone. */
export interface SaleWindow {
	readonly start: WallClock
	readonly end?: WallClock
	readonly zone: string
}

/** A moment (an instant) read in a zone, for a time in the past. */
export interface MomentAt {
	readonly at: Date
	readonly zone?: string
}

/** `11月3日(火)` / `Tue, Nov 3`: a calendar day. */
export function formatEventDay(date: CivilDate, locale: ConsoleLocale): string {
	return formatDay(date, locale)
}

/** `2026年11月3日(火)` / `Tue, Nov 3, 2026`: a calendar day with its year. */
export function formatEventDate(
	date: CivilDate,
	locale: ConsoleLocale,
): string {
	return formatDay(date, locale, { year: true })
}

/** The parenthesis that follows an Event's zone label: Japan time, when the zone is not Japan's. */
function japanTimeNote(
	wall: WallClock,
	zone: string,
	locale: ConsoleLocale,
): string {
	if (zone === JAPAN_TIME_ZONE) return ''
	const japan = convertWall(wall, zone, JAPAN_TIME_ZONE)
	if (!japan) return ''
	const reading = `${zoneLabel(JAPAN_TIME_ZONE, locale)} ${otherZoneReading(wall, japan, locale)}`
	return locale === 'ja' ? `（${reading}）` : ` (${reading})`
}

/**
 * An Event's date and start time at its Venue with the zone's name, and Japan
 * time after it for a Venue outside Japan:
 * `2月20日(土) 19:30 ロンドン時間（日本時間 2月21日(日) 04:30）`. An Event with
 * no start time is its day alone, which carries no label.
 */
export function formatEventWhen(
	when: EventWhen,
	locale: ConsoleLocale,
): string {
	if (!when.time) return formatEventDay(when.date, locale)
	const wall: WallClock = { ...when.date, ...when.time }
	const text = formatDayTime(wall, locale)
	if (!when.zone) return text
	return `${text} ${formatZoneAtVenue(when.date, when.time, when.zone, locale)}`
}

/**
 * The zone's name that follows the times of an Event on `date`, and, for a
 * zone other than Japan's, the Japan time of `time` in parentheses:
 * `ロンドン時間（日本時間 2月21日(日) 04:30）`. `time` is the start time; without
 * one only the name is returned.
 */
export function formatZoneAtVenue(
	date: CivilDate,
	time: WallTime | undefined,
	zone: string,
	locale: ConsoleLocale,
): string {
	const name = zoneLabel(zone, locale)
	return time
		? `${name}${japanTimeNote({ ...date, ...time }, zone, locale)}`
		: name
}

/**
 * A sale's window in the sale's zone, named once after the end:
 * `10月10日(土) 12:00 〜 10月17日(土) 23:59 日本時間`.
 */
export function formatSaleWindow(
	window: SaleWindow,
	locale: ConsoleLocale,
): string {
	const label = zoneLabel(window.zone, locale)
	const start = formatDayTime(window.start, locale)
	return window.end
		? `${start} 〜 ${formatDayTime(window.end, locale)} ${label}`
		: `${start} ${label} 〜`
}

/** One moment of a sale in its zone: `2月1日(月) 12:00 台北時間`. */
export function formatSaleMoment(
	wall: WallClock,
	zone: string,
	locale: ConsoleLocale,
): string {
	return `${formatDayTime(wall, locale)} ${zoneLabel(zone, locale)}`
}

/**
 * A moment in the past read in a zone with its name:
 * `11月3日(火) 14:10 日本時間`. Without a zone the name is left out and the
 * moment is read in UTC.
 */
export function formatMomentAt(
	moment: MomentAt,
	locale: ConsoleLocale,
): string {
	const zone = moment.zone
	const wall = instantToWall(moment.at, zone ?? 'UTC')
	const text = formatDayTime(wall, locale)
	return zone ? `${text} ${zoneLabel(zone, locale)}` : text
}

/** A count with digit separators: `1,380`. */
export function formatCount(
	value: number | bigint,
	locale: ConsoleLocale,
): string {
	return new Intl.NumberFormat(locale).format(value)
}

/**
 * A yen amount: `¥6,500` in English. Japanese writes ticket prices as
 * `6,500円`, which the `ja` currency style does not produce (`￥6,500`), so the
 * Japanese form takes the formatted number and the catalog's `円` pattern.
 */
export function formatYen(
	value: number | bigint,
	locale: ConsoleLocale,
	jaPattern: (amount: string) => string = (amount) => `${amount}円`,
): string {
	if (locale === 'ja') return jaPattern(formatCount(value, 'ja'))
	return new Intl.NumberFormat('en', {
		style: 'currency',
		currency: 'JPY',
	}).format(value)
}

/** The `date` input value (`2026-10-10`) of a civil date. */
export function toDateInput(date: CivilDate): string {
	return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}
