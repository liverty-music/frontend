import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { ProtoConcert } from '../../adapter/rpc/client/concert-client'
import { displayName } from '../../entities/user'

/** Japan time, in which every event date and time is held and compared. */
export const EVENT_TIME_ZONE = 'Asia/Tokyo'

/** A performer of the event, with what a follow control needs. */
export interface EventPerformer {
	readonly id: string
	readonly name: string
	readonly mbid: string
}

/**
 * One Event of a first-party Series, as the Event page shows it. Text the
 * organizer entered (title, description, venue as listed) is kept as entered.
 */
export interface EventPageEvent {
	readonly id: string
	readonly seriesId: string
	readonly title: string
	readonly description: string
	/** Large cover image URL, or empty when the Series has no cover. */
	readonly coverUrl: string
	readonly performers: readonly EventPerformer[]
	/** Calendar date as `YYYY-MM-DD`. */
	readonly dateKey: string
	/** The calendar date at local midnight, for date formatting only. */
	readonly date: Date
	readonly openTime?: Date
	readonly startTime?: Date
	readonly venueName: string
	/** ISO 3166-2 code of the venue's prefecture, or empty. */
	readonly adminArea: string
	readonly cancelled: boolean
}

/** Build the Event page's view of a proto Concert, or null without a date. */
export function eventFromProto(proto: ProtoConcert): EventPageEvent | null {
	const d = proto.localDate?.value
	if (!d || d.year === 0 || d.month === 0 || d.day === 0) return null
	const series = proto.series
	return {
		id: proto.id?.value ?? '',
		seriesId: series?.id?.value ?? '',
		title: series?.title?.value ?? '',
		description: series?.description?.value ?? '',
		coverUrl: series?.media?.attributes?.large?.value ?? '',
		performers: (proto.performers ?? []).flatMap((p) => {
			const id = p.id?.value
			return id
				? [{ id, name: p.name?.value ?? '', mbid: p.mbid?.value ?? '' }]
				: []
		}),
		dateKey: dateKeyOf(d.year, d.month, d.day),
		date: new Date(d.year, d.month - 1, d.day),
		openTime: proto.openTime?.value
			? timestampDate(proto.openTime.value)
			: undefined,
		startTime: proto.startTime?.value
			? timestampDate(proto.startTime.value)
			: undefined,
		// The organizer typed the listed name; show it as entered.
		venueName: proto.listedVenueName?.value || proto.venue?.name?.value || '',
		adminArea: proto.venue?.adminArea?.value ?? '',
		cancelled: series?.publishState === PublishState.CANCELLED,
	}
}

function dateKeyOf(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Today's calendar date in Japan time, as `YYYY-MM-DD`. */
export function todayInJapan(now: Date = new Date()): string {
	// en-CA formats a date as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: EVENT_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now)
}

/** True when the event's date is before today's date in Japan time. */
export function isEnded(
	event: EventPageEvent,
	now: Date = new Date(),
): boolean {
	return event.dateKey < todayInJapan(now)
}

/** Long date with weekday in the display language, e.g. "2026年11月20日(金)". */
export function formatEventDate(event: EventPageEvent, lang: string): string {
	return new Intl.DateTimeFormat(lang, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		weekday: 'short',
	}).format(event.date)
}

/** Short date with weekday for a date tab, e.g. "11/20(金)". */
export function formatTabDate(event: EventPageEvent, lang: string): string {
	return new Intl.DateTimeFormat(lang, {
		month: 'numeric',
		day: 'numeric',
		weekday: 'short',
	}).format(event.date)
}

/** A time of day in Japan time, 24-hour, e.g. "18:30". */
export function formatEventTime(time: Date): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: EVENT_TIME_ZONE,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(time)
}

/** The venue's prefecture as a localized name, never the raw code. */
export function prefectureLabel(event: EventPageEvent, lang: string): string {
	if (!event.adminArea) return ''
	const name = displayName(event.adminArea, lang === 'en' ? 'en' : 'ja')
	return name === event.adminArea ? '' : name
}

/**
 * A sale's start in Japan time with weekday, date and 24-hour time, e.g.
 * "2026年11月1日(日) 10:00".
 */
export function formatSaleStart(start: Date, lang: string): string {
	const date = new Intl.DateTimeFormat(lang, {
		timeZone: EVENT_TIME_ZONE,
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		weekday: 'short',
	}).format(start)
	return `${date} ${formatEventTime(start)}`
}

/** Google Maps search URL for the event's venue. */
export function googleMapsUrl(event: EventPageEvent, lang: string): string {
	const area = prefectureLabel(event, lang)
	const query = area ? `${event.venueName} ${area}` : event.venueName
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** How the Series' dates are offered: tabs for 2–4 Events, a list above 4. */
export type DateNavMode = 'none' | 'tabs' | 'list'

/** Up to this many Events are shown as tabs; more become a list. */
export const MAX_DATE_TABS = 4

export function dateNavMode(
	seriesEvents: readonly EventPageEvent[],
): DateNavMode {
	if (seriesEvents.length < 2) return 'none'
	return seriesEvents.length <= MAX_DATE_TABS ? 'tabs' : 'list'
}

/** The canonical, shareable URL of an Event page, without any query. */
export function canonicalEventUrl(origin: string, eventId: string): string {
	return `${origin}/events/${eventId}`
}

/** Default length of a calendar entry when the event has no end time. */
const CALENDAR_DURATION_MS = 2 * 60 * 60 * 1000

/**
 * An iCalendar (.ics) document for the event. Times are written as UTC
 * instants, which keep the Japan-time start exact in every calendar app. An
 * event without any announced time becomes an all-day entry on its date.
 */
export function buildIcs(
	event: EventPageEvent,
	url: string,
	now: Date = new Date(),
): string {
	const start = event.startTime ?? event.openTime
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Liverty Music//Event Page//EN',
		'CALSCALE:GREGORIAN',
		'BEGIN:VEVENT',
		`UID:${event.id}@liverty-music.app`,
		`DTSTAMP:${icsUtc(now)}`,
	]
	if (start) {
		lines.push(
			`DTSTART:${icsUtc(start)}`,
			`DTEND:${icsUtc(new Date(start.getTime() + CALENDAR_DURATION_MS))}`,
		)
	} else {
		const day = event.dateKey.replace(/-/g, '')
		const next = new Date(event.date)
		next.setDate(next.getDate() + 1)
		lines.push(
			`DTSTART;VALUE=DATE:${day}`,
			`DTEND;VALUE=DATE:${dateKeyOf(next.getFullYear(), next.getMonth() + 1, next.getDate()).replace(/-/g, '')}`,
		)
	}
	lines.push(
		`SUMMARY:${icsText(event.title)}`,
		`LOCATION:${icsText(event.venueName)}`,
		`URL:${url}`,
		'END:VEVENT',
		'END:VCALENDAR',
	)
	return `${lines.join('\r\n')}\r\n`
}

function icsUtc(d: Date): string {
	return d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '')
}

/** Escape a TEXT value per RFC 5545. */
function icsText(s: string): string {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n')
}
