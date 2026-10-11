import { SeriesImageService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/organizer/series_image/v1/series_image_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createOrganizerTransport } from './organizer-transport'

export const ISeriesImageClient = DI.createInterface<ISeriesImageClient>(
	'ISeriesImageClient',
	(x) => x.singleton(SeriesImageClient),
)

export interface ISeriesImageClient extends SeriesImageClient {}

/** A signed upload URL for a new SeriesImage: where to `PUT`, the image's id,
 * and the size ceiling the signed URL was bound to. */
export interface SeriesImageUploadUrl {
	/** The short-lived GCS V4 signed `PUT` URL the client uploads the bytes to. */
	readonly uploadUrl: string
	/** The SeriesImage to set as the cover via `SeriesClient.setCoverImage`. */
	readonly seriesImageId: string
	/** The upper byte bound the signed URL was minted with (for the range header). */
	readonly maxBytes: number
}

/**
 * Organizer-local wrapper around the generated organizer `SeriesImageService`
 * client: steps 1 and 2 of the async cover-image pipeline. Step 3, setting the
 * uploaded image as a Series' cover, is `SeriesClient.setCoverImage`.
 *
 * Built from organizer/shared modules via {@link createOrganizerTransport}; it
 * never imports the consumer `src/` nor the sibling `admin/` bundle. Errors
 * propagate to callers.
 */
export class SeriesImageClient {
	private readonly logger = resolve(ILogger).scopeTo('SeriesImageClient')
	private readonly client = createClient(
		SeriesImageService,
		createOrganizerTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('OrganizerTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Step 1 of the async cover-image pipeline: mints a SeriesImage id and a
	 * short-lived GCS V4 signed `PUT` URL bound to `contentType`. The client then
	 * uploads the bytes directly to that URL (see {@link uploadToSignedUrl}) and
	 * sets the image as the cover with `SeriesClient.setCoverImage`. The image is
	 * not live until the backend finishes async processing (variants 404 until
	 * then).
	 */
	public async createUploadUrl(
		contentType: string,
		signal?: AbortSignal,
	): Promise<SeriesImageUploadUrl> {
		this.logger.info('Creating series image upload URL', { contentType })
		try {
			const response = await this.client.createUploadUrl(
				{ contentType },
				{ signal },
			)
			const uploadUrl = response.uploadUrl?.value
			const seriesImageId = response.seriesImageId?.value
			if (!uploadUrl || !seriesImageId) {
				throw new Error('CreateUploadUrl returned an incomplete response.')
			}
			return { uploadUrl, seriesImageId, maxBytes: Number(response.maxBytes) }
		} catch (err) {
			this.logger.warn('createUploadUrl failed', { contentType, error: err })
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
		upload: SeriesImageUploadUrl,
		body: Blob,
		contentType: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Uploading series image bytes', {
			seriesImageId: upload.seriesImageId,
			contentType,
			bytes: body.size,
		})
		const response = await fetch(upload.uploadUrl, {
			method: 'PUT',
			headers: {
				'Content-Type': contentType,
				'x-goog-content-length-range': `0,${upload.maxBytes}`,
			},
			body,
			signal,
		})
		if (!response.ok) {
			this.logger.warn('Signed upload failed', {
				seriesImageId: upload.seriesImageId,
				status: response.status,
			})
			throw new Error(`Upload failed with status ${response.status}.`)
		}
	}
}
