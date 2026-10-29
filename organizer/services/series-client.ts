import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import type { Event } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/event_pb.js'
import type {
	Series,
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import type {
	EventDraft as ProtoEventDraft,
	SeriesDraft as ProtoSeriesDraft,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/series/v1/series_service_pb.js'
import {
	EventDraftSchema,
	SeriesDraftSchema,
	SeriesService,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/series/v1/series_service_pb.js'
import { create } from '@bufbuild/protobuf'
import { timestampFromDate } from '@bufbuild/protobuf/wkt'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { concertResolver } from '../../shared/lib/concert/resolve-concert'
import { IAuthService } from '../../shared/services/auth-service'
import { IConsoleLanguage } from '../i18n/console-language'
import { createOrganizerTransport } from './organizer-transport'

export type { ProtoEventDraft, ProtoSeriesDraft }

/**
 * One authored Series as the console shows it: the Series, its dates and its
 * performers. The SeriesService returns the Series, its dates as Concerts and
 * each Artist once; {@link authoredSeriesFrom} groups the Concerts back by
 * `event.seriesId`. Each date carries its own publish state
 * (`event.publishState`): DRAFT, PUBLISHED or CANCELLED.
 */
export interface AuthoredSeries {
	readonly series: Series
	/** The dates of the Series, in the order the response lists them. */
	readonly events: Event[]
	/** The performing Artists, each once, in first-listed order. */
	readonly performers: Artist[]
}

/** Group a SeriesService response into one {@link AuthoredSeries} per Series. */
export function authoredSeriesFrom(response: {
	series: readonly Series[]
	concerts: readonly Concert[]
	artists: readonly Artist[]
}): AuthoredSeries[] {
	const resolve = concertResolver(response.series, response.artists)
	const bySeries = new Map<string, AuthoredSeries>()
	for (const series of response.series) {
		const id = series.id?.value
		if (id) bySeries.set(id, { series, events: [], performers: [] })
	}
	for (const concert of response.concerts) {
		const resolved = resolve(concert)
		const entry = bySeries.get(resolved?.event.seriesId?.value ?? '')
		if (!resolved || !entry) continue
		entry.events.push(resolved.event)
		for (const artist of resolved.artists) {
			const id = artist.id?.value
			if (!entry.performers.some((p) => p.id?.value === id)) {
				entry.performers.push(artist)
			}
		}
	}
	return [...bySeries.values()]
}

/** The one {@link AuthoredSeries} of a single-Series response. */
function oneAuthoredSeries(response: {
	series?: Series
	concerts: readonly Concert[]
	artists: readonly Artist[]
}): AuthoredSeries | undefined {
	if (!response.series) return undefined
	return authoredSeriesFrom({ ...response, series: [response.series] })[0]
}

/** A calendar date as year / 1-based month / day (matches `google.type.Date`). */
export interface CalendarDate {
	year: number
	month: number
	day: number
}

/**
 * The plain, transport-agnostic shape of one authored event. `startTime` /
 * `openTime` are absolute instants (the console composes them from the event's
 * local date + a wall-clock time); omitted when not yet confirmed.
 */
export interface EventDraftInput {
	/**
	 * The id of the existing Event this entry edits; omitted for a new date,
	 * which the server adds as a DRAFT Event.
	 */
	readonly eventId?: string
	readonly venueName: string
	readonly placeId?: string
	readonly localDate: CalendarDate
	readonly startTime?: Date
	readonly openTime?: Date
	/** The most tickets one account may hold for the date (1 to 10); the server's default is 4. */
	readonly perAccountLimit?: number
}

/** The plain, transport-agnostic authoring payload shared by create + update. */
export interface SeriesDraftInput {
	readonly title: string
	readonly type: SeriesType
	readonly visibility: Visibility
	readonly description?: string
	readonly sourceUrl?: string
	readonly artistIds: readonly string[]
	readonly events: readonly EventDraftInput[]
}

/** Marshals a plain event input into the generated `EventDraft` message. */
function toEventDraft(input: EventDraftInput): ProtoEventDraft {
	return create(EventDraftSchema, {
		...(input.eventId ? { eventId: { value: input.eventId } } : {}),
		venueName: { value: input.venueName },
		...(input.placeId ? { placeId: { value: input.placeId } } : {}),
		// LocalDate wraps a google.type.Date (a plain Y/M/D triple). Pass the
		// calendar triple directly as a message init rather than constructing
		// the googleapis Date message shell.
		localDate: {
			value: {
				year: input.localDate.year,
				month: input.localDate.month,
				day: input.localDate.day,
			},
		},
		...(input.startTime
			? { startTime: { value: timestampFromDate(input.startTime) } }
			: {}),
		...(input.openTime
			? { openTime: { value: timestampFromDate(input.openTime) } }
			: {}),
		...(input.perAccountLimit !== undefined
			? { perAccountLimit: input.perAccountLimit }
			: {}),
	})
}

/** Marshals a plain series input into the generated `SeriesDraft` message. */
export function toSeriesDraft(input: SeriesDraftInput): ProtoSeriesDraft {
	return create(SeriesDraftSchema, {
		title: { value: input.title },
		type: input.type,
		visibility: input.visibility,
		...(input.description ? { description: { value: input.description } } : {}),
		...(input.sourceUrl ? { sourceUrl: { value: input.sourceUrl } } : {}),
		artistIds: input.artistIds.map((id) => ({ value: id })),
		events: input.events.map(toEventDraft),
	})
}

export const ISeriesClient = DI.createInterface<ISeriesClient>(
	'ISeriesClient',
	(x) => x.singleton(SeriesClient),
)

export interface ISeriesClient extends SeriesClient {}

/**
 * Organizer-local wrapper around the generated organizer `SeriesService`
 * client: the authoring surface (create / update / publish / cancel /
 * setCoverImage / regenerateShareUrl / list). The caller's
 * Organizer is resolved from the token, so no request carries an organizer id;
 * a series is addressed by its {@link SeriesId}.
 *
 * Built from organizer/shared modules via {@link createOrganizerTransport}; it
 * never imports the consumer `src/` nor the sibling `admin/` bundle. Callers
 * pass plain inputs ({@link SeriesDraftInput}); this wrapper owns marshalling
 * them into the generated message shells. Errors propagate to callers (screens
 * choose catalog copy from the `ConnectError` code and log the error).
 */
export class SeriesClient {
	private readonly logger = resolve(ILogger).scopeTo('SeriesClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		SeriesService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
			resolve(IConsoleLanguage),
		),
	)

	/** Returns the caller's own authored series (drafts and published). */
	public async list(signal?: AbortSignal): Promise<AuthoredSeries[]> {
		this.logger.info('Listing authored series')
		try {
			const response = await this.client.list({}, { signal })
			return authoredSeriesFrom(response)
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/** Authors a new first-party concert in the DRAFT state. */
	public async create(
		draft: SeriesDraftInput,
		signal?: AbortSignal,
	): Promise<AuthoredSeries | undefined> {
		this.logger.info('Creating draft concert', { title: draft.title })
		try {
			const response = await this.client.create(
				{ draft: toSeriesDraft(draft) },
				{ signal },
			)
			return oneAuthoredSeries(response)
		} catch (err) {
			this.logger.warn('create failed', { title: draft.title, error: err })
			throw err
		}
	}

	/** Replaces an existing series' authored content. */
	public async update(
		seriesId: string,
		draft: SeriesDraftInput,
		signal?: AbortSignal,
	): Promise<AuthoredSeries | undefined> {
		this.logger.info('Updating concert', { seriesId })
		try {
			const response = await this.client.update(
				{
					seriesId: { value: seriesId },
					draft: toSeriesDraft(draft),
				},
				{ signal },
			)
			return oneAuthoredSeries(response)
		} catch (err) {
			this.logger.warn('update failed', { seriesId, error: err })
			throw err
		}
	}

	/**
	 * Publishes the named DRAFT events of a series, or every DRAFT event when
	 * none is named.
	 */
	public async publish(
		seriesId: string,
		eventIds: readonly string[] = [],
		signal?: AbortSignal,
	): Promise<AuthoredSeries | undefined> {
		this.logger.info('Publishing events', { seriesId, eventIds })
		try {
			const response = await this.client.publish(
				{
					seriesId: { value: seriesId },
					eventIds: eventIds.map((value) => ({ value })),
				},
				{ signal },
			)
			return oneAuthoredSeries(response)
		} catch (err) {
			this.logger.warn('publish failed', { seriesId, error: err })
			throw err
		}
	}

	/**
	 * Cancels the named events of a series, or every PUBLISHED and DRAFT event
	 * when none is named: a PUBLISHED event becomes CANCELLED and a DRAFT event
	 * is removed.
	 */
	public async cancel(
		seriesId: string,
		eventIds: readonly string[] = [],
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Cancelling events', { seriesId, eventIds })
		try {
			await this.client.cancel(
				{
					seriesId: { value: seriesId },
					eventIds: eventIds.map((value) => ({ value })),
				},
				{ signal },
			)
		} catch (err) {
			this.logger.warn('cancel failed', { seriesId, error: err })
			throw err
		}
	}

	/**
	 * Step 3 of the async cover-image pipeline: sets the uploaded SeriesImage as
	 * the series' cover image and enqueues async processing. Returns once the
	 * cover is recorded; the served variants appear only after processing
	 * completes. Steps 1 and 2 are on `SeriesImageClient`.
	 */
	public async setCoverImage(
		seriesId: string,
		seriesImageId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Setting cover image', { seriesId, seriesImageId })
		try {
			await this.client.setCoverImage(
				{
					seriesId: { value: seriesId },
					seriesImageId: { value: seriesImageId },
				},
				{ signal },
			)
		} catch (err) {
			this.logger.warn('setCoverImage failed', {
				seriesId,
				seriesImageId,
				error: err,
			})
			throw err
		}
	}

	/**
	 * Rotates the signed share token for an UNLISTED series, invalidating the
	 * previous share URL, and returns the new URL.
	 */
	public async regenerateShareUrl(
		seriesId: string,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		this.logger.info('Regenerating share URL', { seriesId })
		try {
			const response = await this.client.regenerateShareUrl(
				{ seriesId: { value: seriesId } },
				{ signal },
			)
			return response.shareUrl?.value
		} catch (err) {
			this.logger.warn('regenerateShareUrl failed', { seriesId, error: err })
			throw err
		}
	}
}
