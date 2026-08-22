import { bestBackgroundUrl } from '../../entities/artist'
import type { LiveEvent } from './live-event'

/** Background image URL from the event's resolved artist, or undefined. */
export function eventBackgroundUrl(
	event: LiveEvent | null | undefined,
): string | undefined {
	return bestBackgroundUrl(event?.artist)
}

/** True when the event has a known merchandise URL. */
export function eventHasMerchUrl(event: LiveEvent | null | undefined): boolean {
	return Boolean(event?.merchUrl)
}

/** Google Maps search URL for the event's venue. */
export function eventGoogleMapsUrl(
	event: LiveEvent | null | undefined,
): string {
	if (!event) return '#'
	const area = event.locationLabel
	const query = area ? `${event.venueName} ${area}` : event.venueName
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** Google Calendar "add event" URL for the event. */
export function eventCalendarUrl(event: LiveEvent | null | undefined): string {
	if (!event) return '#'
	const e = event
	const dateStr = [
		e.date.getFullYear(),
		String(e.date.getMonth() + 1).padStart(2, '0'),
		String(e.date.getDate()).padStart(2, '0'),
	].join('')
	const startTime = e.startTime || '19:00'
	const startStr = `${startTime.replace(':', '')}00`
	const [hours, mins] = startTime.split(':').map(Number)
	const endDate = new Date(e.date)
	endDate.setHours(hours + 2, mins)
	const endDateStr = [
		endDate.getFullYear(),
		String(endDate.getMonth() + 1).padStart(2, '0'),
		String(endDate.getDate()).padStart(2, '0'),
	].join('')
	const endStr = `${String(endDate.getHours()).padStart(2, '0')}${String(endDate.getMinutes()).padStart(2, '0')}00`
	return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${dateStr}T${startStr}/${endDateStr}T${endStr}&location=${encodeURIComponent(e.venueName)}`
}

/** Open-time string or an em-dash fallback when none is recorded. */
export function eventOpenTimeOrFallback(
	event: LiveEvent | null | undefined,
): string {
	return event?.openTime ?? '—'
}
