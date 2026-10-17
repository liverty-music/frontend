/**
 * Japan-time and yen formatting for the organizer console.
 *
 * Every date and time is shown in Japan time with "JST", whatever the device's
 * time zone, and every date and time a member enters is read as Japan time.
 * Japan has no daylight saving time, so Japan time is always UTC+09:00.
 */

export type ConsoleLocale = 'ja' | 'en'

export const JAPAN_TIME_ZONE = 'Asia/Tokyo'
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()

function formatter(
	locale: ConsoleLocale,
	key: string,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const id = `${locale}:${key}`
	let f = dateTimeFormats.get(id)
	if (!f) {
		f = new Intl.DateTimeFormat(locale, {
			...options,
			timeZone: JAPAN_TIME_ZONE,
		})
		dateTimeFormats.set(id, f)
	}
	return f
}

const TIME: Intl.DateTimeFormatOptions = {
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
}

function dayOptions(locale: ConsoleLocale): Intl.DateTimeFormatOptions {
	return {
		month: locale === 'ja' ? 'long' : 'short',
		day: 'numeric',
		weekday: 'short',
	}
}

/** `11月3日(火) 18:00 JST` / `Tue, Nov 3, 18:00 JST`. */
export function formatJstDateTime(date: Date, locale: ConsoleLocale): string {
	return `${formatter(locale, 'datetime', { ...dayOptions(locale), ...TIME }).format(date)} JST`
}

/**
 * A window in Japan time: `10月10日(土) 12:00 〜 10月17日(土) 23:59 JST`.
 */
export function formatJstRange(
	start: Date,
	end: Date | undefined,
	locale: ConsoleLocale,
): string {
	const dt = formatter(locale, 'datetime', { ...dayOptions(locale), ...TIME })
	const from = dt.format(start)
	return end ? `${from} 〜 ${dt.format(end)} JST` : `${from} JST 〜`
}

/** `2026年11月3日(火)` / `Tue, Nov 3, 2026`: a calendar day, no time. */
export function formatJstDate(date: Date, locale: ConsoleLocale): string {
	return formatter(locale, 'date', {
		...dayOptions(locale),
		year: 'numeric',
	}).format(date)
}

/** `11月3日(火)` / `Tue, Nov 3`: a calendar day in the current year's style. */
export function formatJstDay(date: Date, locale: ConsoleLocale): string {
	return formatter(locale, 'day', dayOptions(locale)).format(date)
}

/** `18:00 JST`. */
export function formatJstTime(date: Date, locale: ConsoleLocale): string {
	return `${formatter(locale, 'time', TIME).format(date)} JST`
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

/** Wall-clock parts of a Japan-time instant. */
function jstParts(date: Date): {
	year: number
	month: number
	day: number
	hour: number
	minute: number
} {
	const shifted = new Date(date.getTime() + JST_OFFSET_MS)
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
	}
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Reads an `<input type="datetime-local">` value (`2026-10-10T12:00`) as Japan
 * time. Returns undefined for an empty or malformed value.
 */
export function parseJstDateTimeLocal(value: string): Date | undefined {
	const m = value.match(
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
	)
	if (!m) return undefined
	const [year, month, day, hour, minute] = m.slice(1, 6).map(Number)
	const date = new Date(
		Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS,
	)
	// Reject values that roll over (2026-02-30 → March 2).
	const back = jstParts(date)
	if (back.month !== month || back.day !== day) return undefined
	return date
}

/**
 * Reads a date (`2026-10-10`) and a time (`18:00`) entered separately as one
 * Japan-time instant.
 */
export function parseJstDateAndTime(
	date: string,
	time: string,
): Date | undefined {
	return parseJstDateTimeLocal(`${date}T${time}`)
}

/** The `datetime-local` value showing `date` in Japan time. */
export function toJstDateTimeLocal(date: Date): string {
	const p = jstParts(date)
	return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** The `date` input value of `date`'s Japan-time calendar day. */
export function toJstDateInput(date: Date): string {
	return toJstDateTimeLocal(date).slice(0, 10)
}

/** The `time` input value of `date`'s Japan-time wall clock. */
export function toJstTimeInput(date: Date): string {
	return toJstDateTimeLocal(date).slice(11)
}

/**
 * A Japan-time instant as the console enters it (design D19): a date field
 * (`YYYY-MM-DD`) and a 24-hour time field (`HH:mm`), each '' while unset.
 */
export interface JstDateTime {
	date: string
	time: string
}

/** An unset date and time. */
export function emptyJstDateTime(): JstDateTime {
	return { date: '', time: '' }
}

/** The date and time fields showing `date` in Japan time. */
export function toJstDateTime(date: Date): JstDateTime {
	const local = toJstDateTimeLocal(date)
	return { date: local.slice(0, 10), time: local.slice(11) }
}

/** The instant of a date and a time entered in Japan time, or undefined. */
export function parseJstDateTime(value: JstDateTime): Date | undefined {
	return parseJstDateAndTime(value.date.trim(), value.time.trim())
}

/**
 * The part of `value` that keeps it from being an instant, the date first:
 * 'date' while the date is unset or not a calendar day, 'time' while the
 * time is unset or malformed, null once it reads as an instant.
 */
export function unsetPartOf(value: JstDateTime): 'date' | 'time' | null {
	const date = value.date.trim()
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'date'
	if (!parseJstDateAndTime(date, '00:00')) return 'date'
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time.trim())) return 'time'
	return null
}

/** True when both parts are the same. */
export function sameJstDateTime(a: JstDateTime, b: JstDateTime): boolean {
	return a.date === b.date && a.time === b.time
}
