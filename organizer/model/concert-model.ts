import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { AuthoredSeries } from '../services/series-client'
import type { StatusTone } from '../ui/status-badge/status-badge'

/**
 * Plain readings of an authored concert and its events for the console's
 * screens. Labels are catalog keys; the screens translate them.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export function seriesId(concert: AuthoredSeries): string {
	return concert.series.id?.value ?? ''
}

export function eventId(event: Event): string {
	return event.id?.value ?? ''
}

export function concertTitle(concert: AuthoredSeries): string {
	return concert.series.title?.value ?? ''
}

/** The event's start instant, when it is set. */
export function eventStart(event: Event): Date | undefined {
	const ts = event.startTime?.value
	return ts ? timestampDate(ts) : undefined
}

/** Midnight in Japan time of the event's local date. */
export function eventDay(event: Event): Date | undefined {
	const d = event.localDate?.value
	if (!d) return undefined
	return new Date(Date.UTC(d.year, d.month - 1, d.day) - JST_OFFSET_MS)
}

/** The instant used to order events: the start time, else the day. */
export function eventSortKey(event: Event): number {
	return (eventStart(event) ?? eventDay(event))?.getTime() ?? 0
}

export function venueName(event: Event): string {
	return event.venue?.name?.value || event.listedVenueName?.value || ''
}

export function isCancelled(event: Event): boolean {
	return event.publishState === PublishState.CANCELLED
}

export function isDraft(event: Event): boolean {
	return event.publishState === PublishState.DRAFT
}

export function isPublished(event: Event): boolean {
	return event.publishState === PublishState.PUBLISHED
}

/** The concert's events in date order. */
export function eventsByDate(concert: AuthoredSeries): Event[] {
	return [...concert.events].sort((a, b) => eventSortKey(a) - eventSortKey(b))
}

/** The concert is cancelled when every one of its events is. */
export function concertCancelled(concert: AuthoredSeries): boolean {
	return concert.events.length > 0 && concert.events.every(isCancelled)
}

export function findConcert(
	concerts: readonly AuthoredSeries[],
	id: string,
): AuthoredSeries | undefined {
	return concerts.find((c) => seriesId(c) === id)
}

export function findEvent(
	concert: AuthoredSeries | undefined,
	id: string,
): Event | undefined {
	return concert?.events.find((e) => eventId(e) === id)
}

export interface PublishBadge {
	tone: StatusTone
	labelKey: string
}

/** The labelled badge of a publish state (公開中, 下書き, 中止). */
export function publishBadge(state: PublishState): PublishBadge {
	switch (state) {
		case PublishState.PUBLISHED:
			return { tone: 'success', labelKey: 'publishState.published' }
		case PublishState.CANCELLED:
			return { tone: 'error', labelKey: 'publishState.cancelled' }
		default:
			return { tone: 'neutral', labelKey: 'publishState.draft' }
	}
}

export function seriesTypeKey(type: SeriesType): string {
	switch (type) {
		case SeriesType.TOUR:
			return 'seriesType.tour'
		case SeriesType.FESTIVAL:
			return 'seriesType.festival'
		default:
			return 'seriesType.single'
	}
}

export function visibilityKey(visibility: Visibility): string {
	return visibility === Visibility.UNLISTED
		? 'visibility.unlisted'
		: 'visibility.public'
}

export function performerNames(concert: AuthoredSeries): string[] {
	return concert.performers.map((a) => a.name?.value ?? '').filter(Boolean)
}

/** Console paths of a concert and its event pages. */
export const paths = {
	concerts: '/concerts',
	newConcert: '/concerts/new',
	concert: (series: string) => `/concerts/${series}`,
	editConcert: (series: string) => `/concerts/${series}/edit`,
	event: (series: string, event: string) =>
		`/concerts/${series}/events/${event}/sales`,
	sales: (series: string, event: string) =>
		`/concerts/${series}/events/${event}/sales`,
	reception: (series: string, event: string) =>
		`/concerts/${series}/events/${event}/reception`,
	newLottery: (series: string, event: string) =>
		`/concerts/${series}/events/${event}/sales/lottery/new`,
	lottery: (series: string, event: string, sale: string) =>
		`/concerts/${series}/events/${event}/sales/lottery/${sale}`,
	firstCome: (series: string, event: string) =>
		`/concerts/${series}/events/${event}/sales/first-come`,
	settings: '/settings',
	payout: '/settings#payout',
	home: '/home',
}
