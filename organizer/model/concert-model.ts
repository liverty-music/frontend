import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import {
	PublishState,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import {
	fanOriginOf,
	type KnownEnvironment,
} from '../../shared/config/known-hosts'
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

/** The per-account limit of a date that was given none (the server's default). */
export const DEFAULT_PER_ACCOUNT_LIMIT = 4
/** Inclusive bounds of a date's per-account limit: one admission code presents at most 10 tickets. */
export const MIN_PER_ACCOUNT_LIMIT = 1
export const MAX_PER_ACCOUNT_LIMIT = 10

/**
 * The most tickets one account may hold for the event, across every sale,
 * seat type and official resale of it.
 */
export function perAccountLimitOf(event: Event): number {
	return event.perAccountLimit ?? DEFAULT_PER_ACCOUNT_LIMIT
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

/** The ids of the concert's performers, in first-listed order. */
export function performerIds(concert: AuthoredSeries): string[] {
	return concert.performers.map((a) => a.id?.value ?? '').filter(Boolean)
}

/** True when the Artist performs in the concert (`Concert.artist_ids`). */
export function performs(concert: AuthoredSeries, artistId: string): boolean {
	return performerIds(concert).includes(artistId)
}

/** The concerts the Artist performs in. */
export function concertsOf(
	concerts: readonly AuthoredSeries[],
	artistId: string,
): AuthoredSeries[] {
	return concerts.filter((c) => performs(c, artistId))
}

/**
 * The Artist a concert is opened under when the address names none (Home):
 * the first of its performers the Organizer represents, else its first
 * performer.
 */
export function homeArtistOf(
	concert: AuthoredSeries,
	represented: ReadonlySet<string>,
): string {
	const ids = performerIds(concert)
	return ids.find((id) => represented.has(id)) ?? ids[0] ?? ''
}

/** The Organizer and the represented Artist a 公演 address is under. */
export interface ArtistScope {
	readonly organizer: string
	readonly artist: string
}

/** How a new sale is sold: the `method` of `ticket-sales/new?method=`. */
export type SaleMethodParam = 'lottery' | 'first-come'

const segment = (id: string) => encodeURIComponent(id)

const organizerPath = (organizer: string) => `/organizers/${segment(organizer)}`

const concertsPath = (scope: ArtistScope) =>
	`${organizerPath(scope.organizer)}/artists/${segment(scope.artist)}/series`

const concertPath = (scope: ArtistScope, series: string) =>
	`${concertsPath(scope)}/${segment(series)}`

const eventPath = (scope: ArtistScope, series: string, event: string) =>
	`${concertPath(scope, series)}/events/${segment(event)}`

/**
 * The router instruction for an in-app path. The router cannot read the root
 * path `/` as an instruction (AUR3500: it expects a component name after the
 * slash), so `/`, `/?…` and `/#…` become the empty path, which is the landing,
 * keeping any query or fragment. Every other path is returned unchanged. Use it
 * wherever a path is handed to the router (a guard's or `canLoad`'s return
 * value, `router.load`); an `href` keeps the path itself.
 */
export function instructionOf(path: string): string {
	return path === '/' || path.startsWith('/?') || path.startsWith('/#')
		? path.slice(1)
		: path
}

/**
 * Every console address (design D1), built from the Organizer and, below 公演,
 * the represented Artist. Templates and view-models take their links from
 * here; no other module writes a console path.
 */
export const paths = {
	/** `/` and unknown addresses: forwards to the caller's Home. */
	landing: '/',
	/** Said for an address that names another Organizer. */
	otherOrganizer: '/other-organizer',
	home: (organizer: string) => organizerPath(organizer),
	settings: (organizer: string) => `${organizerPath(organizer)}/settings`,
	payout: (organizer: string) => `${organizerPath(organizer)}/settings#payout`,
	/** 公演 of an Organizer before an Artist is chosen (none represented yet). */
	artists: (organizer: string) => `${organizerPath(organizer)}/artists`,
	concerts: (scope: ArtistScope) => concertsPath(scope),
	newConcert: (scope: ArtistScope) => `${concertsPath(scope)}/new`,
	concert: (scope: ArtistScope, series: string) => concertPath(scope, series),
	editConcert: (scope: ArtistScope, series: string) =>
		`${concertPath(scope, series)}/edit`,
	/** The event page: it opens on its Sales tab. */
	event: (scope: ArtistScope, series: string, event: string) =>
		`${eventPath(scope, series, event)}/ticket-sales`,
	sales: (scope: ArtistScope, series: string, event: string) =>
		`${eventPath(scope, series, event)}/ticket-sales`,
	scanners: (scope: ArtistScope, series: string, event: string) =>
		`${eventPath(scope, series, event)}/scanners`,
	newSale: (
		scope: ArtistScope,
		series: string,
		event: string,
		method: SaleMethodParam,
	) => `${eventPath(scope, series, event)}/ticket-sales/new?method=${method}`,
	editSale: (scope: ArtistScope, series: string, event: string, sale: string) =>
		`${eventPath(scope, series, event)}/ticket-sales/${segment(sale)}/edit`,
}

/**
 * The address of an event's fan page, `https://<fan origin>/events/<id>`
 * (design D21), or '' when the environment has no fan origin.
 */
export function fanPageUrlOf(
	environment: KnownEnvironment,
	eventId: string,
): string {
	const origin = fanOriginOf(environment)
	return origin ? `${origin}/events/${eventId}` : ''
}
