import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import {
	Description,
	LocalDate,
	OpenTime,
	StartTime,
	Title,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/entity_pb.js'
import type {
	SeriesType,
	Visibility,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { SeriesId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import {
	PlaceId,
	VenueName,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/venue_pb.js'
import { MediaId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/media_pb.js'
import type {
	AuthoredConcert,
	EventDraft as ProtoEventDraft,
	SeriesDraft as ProtoSeriesDraft,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/v1/concert_service_pb.js'
import {
	EventDraft,
	SeriesDraft,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/v1/concert_service_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/organizer/v1/concert_service_connect.js'
import { Timestamp } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export type { AuthoredConcert, ProtoEventDraft, ProtoSeriesDraft }

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
	readonly venueName: string
	readonly placeId?: string
	readonly localDate: CalendarDate
	readonly startTime?: Date
	readonly openTime?: Date
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
function toEventDraft(input: EventDraftInput): EventDraft {
	return new EventDraft({
		venueName: new VenueName({ value: input.venueName }),
		...(input.placeId
			? { placeId: new PlaceId({ value: input.placeId }) }
			: {}),
		// LocalDate wraps a google.type.Date (a plain Y/M/D triple). Pass the
		// calendar triple directly as a PartialMessage rather than constructing
		// the googleapis Date message shell.
		localDate: new LocalDate({
			value: {
				year: input.localDate.year,
				month: input.localDate.month,
				day: input.localDate.day,
			},
		}),
		...(input.startTime
			? {
					startTime: new StartTime({
						value: Timestamp.fromDate(input.startTime),
					}),
				}
			: {}),
		...(input.openTime
			? {
					openTime: new OpenTime({ value: Timestamp.fromDate(input.openTime) }),
				}
			: {}),
	})
}

/** Marshals a plain series input into the generated `SeriesDraft` message. */
export function toSeriesDraft(input: SeriesDraftInput): SeriesDraft {
	return new SeriesDraft({
		title: new Title({ value: input.title }),
		type: input.type,
		visibility: input.visibility,
		...(input.description
			? { description: new Description({ value: input.description }) }
			: {}),
		artistIds: input.artistIds.map((id) => new ArtistId({ value: id })),
		events: input.events.map(toEventDraft),
	})
}

export const IConcertAuthoringClient =
	DI.createInterface<IConcertAuthoringClient>('IConcertAuthoringClient', (x) =>
		x.singleton(ConcertAuthoringClient),
	)

export interface IConcertAuthoringClient extends ConcertAuthoringClient {}

/** A minted signed-upload authorization: where to `PUT`, the media identity,
 * and the size ceiling the signed URL was bound to. */
export interface MediaUploadTicket {
	/** The short-lived GCS V4 signed `PUT` URL the client uploads the bytes to. */
	readonly uploadUrl: string
	/** The media identity to record via {@link ConcertAuthoringClient.attachMedia}. */
	readonly mediaId: string
	/** The upper byte bound the signed URL was minted with (for the range header). */
	readonly maxBytes: number
}

/**
 * Organizer-local wrapper around the generated organizer `ConcertService`
 * client: the authoring surface (create / update / publish / cancel /
 * createMediaUploadUrl / attachMedia / regenerateToken / list). The caller's
 * Organizer is resolved from the token, so no request carries an organizer id;
 * a series is addressed by its {@link SeriesId}.
 *
 * Built from organizer/shared modules via {@link createOrganizerTransport}; it
 * never imports the consumer `src/` nor the sibling `admin/` bundle. Callers
 * pass plain inputs ({@link SeriesDraftInput}); this wrapper owns marshalling
 * them into the generated message shells. Errors propagate to callers (screens
 * translate `ConnectError` codes via {@link ./connect-error-copy}).
 */
export class ConcertAuthoringClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertAuthoringClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ConcertService,
		createOrganizerTransport(
			this.authService,
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/** Returns the caller's own authored concerts (drafts and published). */
	public async list(signal?: AbortSignal): Promise<AuthoredConcert[]> {
		this.logger.info('Listing authored concerts')
		try {
			const response = await this.client.list({}, { signal })
			return response.concerts
		} catch (err) {
			this.logger.warn('list failed', { error: err })
			throw err
		}
	}

	/** Authors a new first-party concert in the DRAFT state. */
	public async create(
		draft: SeriesDraftInput,
		signal?: AbortSignal,
	): Promise<AuthoredConcert | undefined> {
		this.logger.info('Creating draft concert', { title: draft.title })
		try {
			const response = await this.client.create(
				{ draft: toSeriesDraft(draft) },
				{ signal },
			)
			return response.concert
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
	): Promise<AuthoredConcert | undefined> {
		this.logger.info('Updating concert', { seriesId })
		try {
			const response = await this.client.update(
				{
					seriesId: new SeriesId({ value: seriesId }),
					draft: toSeriesDraft(draft),
				},
				{ signal },
			)
			return response.concert
		} catch (err) {
			this.logger.warn('update failed', { seriesId, error: err })
			throw err
		}
	}

	/** Transitions a DRAFT series to PUBLISHED. */
	public async publish(
		seriesId: string,
		signal?: AbortSignal,
	): Promise<AuthoredConcert | undefined> {
		this.logger.info('Publishing concert', { seriesId })
		try {
			const response = await this.client.publish(
				{ seriesId: new SeriesId({ value: seriesId }) },
				{ signal },
			)
			return response.concert
		} catch (err) {
			this.logger.warn('publish failed', { seriesId, error: err })
			throw err
		}
	}

	/** Marks a series CANCELLED (terminal). */
	public async cancel(seriesId: string, signal?: AbortSignal): Promise<void> {
		this.logger.info('Cancelling concert', { seriesId })
		try {
			await this.client.cancel(
				{ seriesId: new SeriesId({ value: seriesId }) },
				{ signal },
			)
		} catch (err) {
			this.logger.warn('cancel failed', { seriesId, error: err })
			throw err
		}
	}

	/**
	 * Step 1 of the async cover-image pipeline: mints a media identity and a
	 * short-lived GCS V4 signed `PUT` URL bound to `contentType`. The client then
	 * uploads the bytes directly to that URL (see {@link uploadToSignedUrl}) and
	 * records the attachment via {@link attachMedia}. The image is not live until
	 * the backend finishes async processing (variants 404 until then).
	 */
	public async createMediaUploadUrl(
		contentType: string,
		signal?: AbortSignal,
	): Promise<MediaUploadTicket> {
		this.logger.info('Creating media upload URL', { contentType })
		try {
			const response = await this.client.createMediaUploadURL(
				{ contentType },
				{ signal },
			)
			const uploadUrl = response.uploadUrl?.value
			const mediaId = response.mediaId?.value
			if (!uploadUrl || !mediaId) {
				throw new Error('CreateMediaUploadURL returned an incomplete ticket.')
			}
			return { uploadUrl, mediaId, maxBytes: Number(response.maxBytes) }
		} catch (err) {
			this.logger.warn('createMediaUploadUrl failed', {
				contentType,
				error: err,
			})
			throw err
		}
	}

	/**
	 * Step 2 of the async cover-image pipeline: uploads the picked file's bytes
	 * directly to the signed `PUT` URL. `x-goog-content-length-range` mirrors the
	 * server-minted ceiling so GCS rejects an oversized body before it lands.
	 * This is a plain `fetch` (not a Connect call): the signed URL carries its
	 * own auth, so the organizer transport is deliberately bypassed.
	 */
	public async uploadToSignedUrl(
		ticket: MediaUploadTicket,
		body: Blob,
		contentType: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Uploading media bytes', {
			mediaId: ticket.mediaId,
			contentType,
			bytes: body.size,
		})
		const response = await fetch(ticket.uploadUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': contentType,
				'x-goog-content-length-range': `0,${ticket.maxBytes}`,
			},
			body,
			signal,
		})
		if (!response.ok) {
			this.logger.warn('Signed upload failed', {
				mediaId: ticket.mediaId,
				status: response.status,
			})
			throw new Error(`Upload failed with status ${response.status}.`)
		}
	}

	/**
	 * Step 3 of the async cover-image pipeline: records the uploaded media on the
	 * series and enqueues async processing. Returns once the attachment is
	 * recorded; the served variants appear only after processing completes.
	 */
	public async attachMedia(
		seriesId: string,
		mediaId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Attaching media', { seriesId, mediaId })
		try {
			await this.client.attachMedia(
				{
					seriesId: new SeriesId({ value: seriesId }),
					mediaId: new MediaId({ value: mediaId }),
				},
				{ signal },
			)
		} catch (err) {
			this.logger.warn('attachMedia failed', { seriesId, mediaId, error: err })
			throw err
		}
	}

	/**
	 * Rotates the signed share token for an UNLISTED series, invalidating the
	 * previous share URL, and returns the new URL.
	 */
	public async regenerateToken(
		seriesId: string,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		this.logger.info('Regenerating share token', { seriesId })
		try {
			const response = await this.client.regenerateToken(
				{ seriesId: new SeriesId({ value: seriesId }) },
				{ signal },
			)
			return response.shareUrl?.value
		} catch (err) {
			this.logger.warn('regenerateToken failed', { seriesId, error: err })
			throw err
		}
	}
}
