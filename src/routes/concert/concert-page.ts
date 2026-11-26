import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import type { ResolvedConcert } from '../../adapter/rpc/client/concert-client'
import { resaleDeadline } from '../../entities/resale-listing'
import { displayName } from '../../entities/user'
import {
	type CivilDate,
	displayLanguage,
	eventInstant,
	formatEventDay,
	formatInstantAtVenue,
	formatEventTimes,
	type EventTimesText,
	formatSaleMoment,
	formatTabDay,
	todayAtVenue,
} from '../../lib/time-format/time-format'
import {
	type WallTime,
	addWallMinutes,
	dateKey as civilDateKey,
	offsetMsAt,
	timeKey,
	wallToInstant,
} from '../../../shared/lib/zoned-time/zoned-time'

/** A performer of the event, with what a follow control needs. */
export interface ConcertPerformer {
	readonly id: string
	readonly name: string
	readonly mbid: string
}

/**
 * One Event of a first-party Series, as the concert page shows it. Text the
 * organizer entered (title, description, venue as listed) is kept as entered.
 */
export interface ConcertPageConcert {
	readonly id: string
	readonly seriesId: string
	readonly title: string
	readonly description: string
	/** Large cover image URL, or empty when the Series has no cover. */
	readonly coverUrl: string
	readonly performers: readonly ConcertPerformer[]
	/** Calendar date as `YYYY-MM-DD`. */
	readonly dateKey: string
	/** The calendar date at local midnight, for date formatting only. */
	readonly date: Date
	/** The calendar date at the Venue. */
	readonly localDate: CivilDate
	/** The wall-clock times at the Venue, read in `timeZone`. */
	readonly openTime?: WallTime
	readonly startTime?: WallTime
	/** The Venue's IANA time zone; absent for a Venue stored before zones were recorded. */
	readonly timeZone?: string
	readonly venueName: string
	/** ISO 3166-2 code of the venue's prefecture, or empty. */
	readonly adminArea: string
	readonly cancelled: boolean
}

/** Build the concert page's view of a resolved Concert, or null without a date. */
export function eventFromConcert(
	concert: ResolvedConcert,
): ConcertPageConcert | null {
	const proto = concert.event
	const d = proto.localDate?.value
	if (!d || d.year === 0 || d.month === 0 || d.day === 0) return null
	const series = concert.series
	return {
		id: proto.id?.value ?? '',
		seriesId: series?.id?.value ?? '',
		title: series?.title?.value ?? '',
		description: series?.description?.value ?? '',
		coverUrl: series?.coverImage?.large?.value ?? '',
		performers: concert.artists.flatMap((p) => {
			const id = p.id?.value
			return id
				? [{ id, name: p.name?.value ?? '', mbid: p.mbid?.value ?? '' }]
				: []
		}),
		dateKey: dateKeyOf(d.year, d.month, d.day),
		date: new Date(d.year, d.month - 1, d.day),
		localDate: { year: d.year, month: d.month, day: d.day },
		openTime: wallTimeOf(proto.openTime?.value),
		startTime: wallTimeOf(proto.startTime?.value),
		timeZone: proto.venue?.timeZone?.value || undefined,
		// The organizer typed the listed name; show it as entered.
		venueName: proto.listedVenueName?.value || proto.venue?.name?.value || '',
		adminArea: proto.venue?.adminArea?.value ?? '',
		// Each date keeps its own state: one date of a tour can be cancelled
		// while the others stay on.
		cancelled: proto.publishState === PublishState.CANCELLED,
	}
}

/** The time of day of a `TimeOfDay`, to the minute; undefined when absent. */
function wallTimeOf(
	time: { hours: number; minutes: number } | undefined,
): WallTime | undefined {
	return time ? { hour: time.hours, minute: time.minutes } : undefined
}

function dateKeyOf(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * True when the event's date is before today's date at its Venue, so a show
 * in London is not ended while it is still that day there. A Venue whose zone
 * is unknown counts as ended only when the date has passed everywhere.
 */
export function isEnded(
	event: ConcertPageConcert,
	now: Date = new Date(),
): boolean {
	return event.dateKey < todayAtVenue(event.timeZone, now)
}

/** Long date with weekday in the display language, e.g. "2026年11月20日(金)". */
export function formatEventDate(
	event: ConcertPageConcert,
	lang: string,
): string {
	return formatEventDay(event.localDate, displayLanguage(lang))
}

/** Short date with weekday for a date tab, e.g. "11/20(金)". */
export function formatTabDate(event: ConcertPageConcert, lang: string): string {
	return formatTabDay(event.localDate, displayLanguage(lang))
}

/** The instant the event starts (else opens), or undefined without a time or zone. */
export function eventStartInstant(event: ConcertPageConcert): Date | undefined {
	const clock = clockOf(event)
	return eventInstant(clock, event.startTime ?? event.openTime)
}

/**
 * The event's open and start times at its Venue, and the zone text that
 * follows them (the Venue zone's name and the viewer's times when the viewer's
 * zone is at another offset).
 */
export function eventTimesText(
	event: ConcertPageConcert,
	lang: string,
): EventTimesText {
	return formatEventTimes(clockOf(event), displayLanguage(lang))
}

/**
 * The resale deadline of an event (its last draw) at its Venue's local time,
 * or '' without a start time or a zone.
 */
export function resaleDeadlineLabel(
	event: ConcertPageConcert,
	lang: string,
): string {
	const deadline = resaleDeadlineOf(event)
	return deadline
		? formatInstantAtVenue(deadline, event.timeZone, displayLanguage(lang))
		: ''
}

/** The instant listing and applying for resale close, or undefined without a start time and zone. */
export function resaleDeadlineOf(event: ConcertPageConcert): Date | undefined {
	const start = eventInstant(clockOf(event), event.startTime)
	return start && event.timeZone
		? resaleDeadline(start, event.timeZone)
		: undefined
}

/** The event's wall-clock times as the formatting module reads them. */
export function clockOf(event: ConcertPageConcert) {
	return {
		date: event.localDate,
		open: event.openTime,
		start: event.startTime,
		timeZone: event.timeZone,
	}
}

/** The venue's prefecture as a localized name, never the raw code. */
export function prefectureLabel(
	event: ConcertPageConcert,
	lang: string,
): string {
	if (!event.adminArea) return ''
	const name = displayName(event.adminArea, lang === 'en' ? 'en' : 'ja')
	return name === event.adminArea ? '' : name
}

/**
 * A moment of a sale in the viewer's zone, named when it is not the sale's
 * zone, e.g. "2026年11月1日(日) 10:00" for a fan in the sale's zone.
 */
export function formatSaleStart(
	instant: Date,
	saleZone: string | undefined,
	lang: string,
): string {
	return formatSaleMoment(instant, saleZone, displayLanguage(lang))
}

/** Google Maps search URL for the event's venue. */
export function googleMapsUrl(event: ConcertPageConcert, lang: string): string {
	const area = prefectureLabel(event, lang)
	const query = area ? `${event.venueName} ${area}` : event.venueName
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** How the Series' dates are offered: tabs for 2–4 Events, a list above 4. */
export type DateNavMode = 'none' | 'tabs' | 'list'

/** Up to this many Events are shown as tabs; more become a list. */
export const MAX_DATE_TABS = 4

export function dateNavMode(
	seriesEvents: readonly ConcertPageConcert[],
): DateNavMode {
	if (seriesEvents.length < 2) return 'none'
	return seriesEvents.length <= MAX_DATE_TABS ? 'tabs' : 'list'
}

/** The canonical, shareable URL of a concert page, without any query. */
export function canonicalEventUrl(origin: string, eventId: string): string {
	return `${origin}/concerts/${eventId}`
}

/** Default length of a calendar entry when the event has no end time. */
const CALENDAR_DURATION_MINUTES = 2 * 60

/** `20270220T193000`, the wall clock of an iCalendar local date-time. */
function icsLocal(wall: {
	year: number
	month: number
	day: number
	hour: number
	minute: number
}): string {
	return `${civilDateKey(wall).replace(/-/g, '')}T${timeKey(wall).replace(':', '')}00`
}

/**
 * An iCalendar (.ics) document for the event. A timed event starts at its
 * wall-clock time in its Venue's time zone (`TZID`), which the fan's calendar
 * converts to the fan's own zone; the entry is not turned into an instant here.
 * An event without any announced time becomes an all-day entry on its date.
 */
export function buildIcs(
	event: ConcertPageConcert,
	url: string,
	now: Date = new Date(),
): string {
	const time = event.startTime ?? event.openTime
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Liverty Music//Event Page//EN',
		'CALSCALE:GREGORIAN',
		'BEGIN:VEVENT',
		`UID:${event.id}@liverty-music.app`,
		`DTSTAMP:${icsUtc(now)}`,
	]
	if (time) {
		const start = { ...event.localDate, ...time }
		const end = addWallMinutes(start, CALENDAR_DURATION_MINUTES)
		// Without a zone the entry is a floating local time.
		const tzid = event.timeZone ? `;TZID=${event.timeZone}` : ''
		if (event.timeZone) {
			const instant = wallToInstant(start, event.timeZone)
			if (instant) {
				lines.splice(
					lines.indexOf('BEGIN:VEVENT'),
					0,
					...icsZone(event.timeZone, offsetMsAt(instant, event.timeZone)),
				)
			}
		}
		lines.push(
			`DTSTART${tzid}:${icsLocal(start)}`,
			`DTEND${tzid}:${icsLocal(end)}`,
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

/**
 * The VTIMEZONE a `TZID` reference needs (RFC 5545 §3.6.5), holding the one
 * offset in force at the event's start. A calendar that knows the IANA name
 * uses its own rules for it.
 */
function icsZone(zone: string, offsetMs: number): string[] {
	const minutes = Math.round(offsetMs / 60_000)
	const abs = Math.abs(minutes)
	const offset = `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`
	return [
		'BEGIN:VTIMEZONE',
		`TZID:${zone}`,
		'BEGIN:STANDARD',
		'DTSTART:19700101T000000',
		`TZOFFSETFROM:${offset}`,
		`TZOFFSETTO:${offset}`,
		'END:STANDARD',
		'END:VTIMEZONE',
	]
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
