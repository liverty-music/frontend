import { bestBackgroundUrl } from '../../entities/artist'
import {
	addWallMinutes,
	dateKey,
	parseTimeKey,
	timeKey,
} from '../../../shared/lib/zoned-time/zoned-time'
import type { Concert } from '../../entities/concert'
import {
	displayLanguage,
	formatEventTimes,
} from '../../lib/time-format/time-format'

/** Background image URL from the event's resolved artist, or undefined. */
export function eventBackgroundUrl(
	event: Concert | null | undefined,
): string | undefined {
	return bestBackgroundUrl(event?.artist)
}

/** Google Maps search URL for the event's venue. */
export function eventGoogleMapsUrl(event: Concert | null | undefined): string {
	if (!event) return '#'
	const area = event.locationLabel
	const query = area ? `${event.venueName} ${area}` : event.venueName
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * Google Calendar "add event" URL for the event. The start is the wall clock
 * at the event's Venue and `ctz` names the Venue's time zone, so the fan's
 * calendar converts it to the fan's own zone. An event without a zone is
 * added at the fan's own zone.
 */
export function eventCalendarUrl(event: Concert | null | undefined): string {
	if (!event) return '#'
	const e = event
	const date = {
		year: e.date.getFullYear(),
		month: e.date.getMonth() + 1,
		day: e.date.getDate(),
	}
	const time = parseTimeKey(e.startTime || '19:00') ?? { hour: 19, minute: 0 }
	const start = { ...date, ...time }
	const end = addWallMinutes(start, 2 * 60)
	const local = (w: typeof start) =>
		`${dateKey(w).replace(/-/g, '')}T${timeKey(w).replace(':', '')}00`
	const ctz = e.timeZone ? `&ctz=${encodeURIComponent(e.timeZone)}` : ''
	return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${local(start)}/${local(end)}${ctz}&location=${encodeURIComponent(e.venueName)}`
}

/**
 * The Venue zone's name and the viewer's times, shown after the open and start
 * times, or '' when the viewer's zone has the Venue's offset.
 */
export function eventZoneText(
	event: Concert | null | undefined,
	lang: string,
): string {
	if (!event) return ''
	const date = {
		year: event.date.getFullYear(),
		month: event.date.getMonth() + 1,
		day: event.date.getDate(),
	}
	return formatEventTimes(
		{
			date,
			open: event.openTime ? parseTimeKey(event.openTime) : undefined,
			start: event.startTime ? parseTimeKey(event.startTime) : undefined,
			timeZone: event.timeZone,
		},
		displayLanguage(lang),
	).zone
}

/** Open-time string or an em-dash fallback when none is recorded. */
export function eventOpenTimeOrFallback(
	event: Concert | null | undefined,
): string {
	return event?.openTime ?? '—'
}
