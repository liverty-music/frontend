import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService as AdminArtistService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/artist/v1/artist_service_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/artist/v1/artist_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Artist }

export const IArtistClient = DI.createInterface<IArtistClient>(
	'IArtistClient',
	(x) => x.singleton(ArtistClient),
)

export interface IArtistClient extends ArtistClient {}

/**
 * Admin-local wrapper for the Artist calls of the organizer screen:
 * `ArtistService.Search`, to pick an artist to associate,
 * `ArtistService.Create`, to register a test artist, and the admin
 * `ArtistService.ListByOrganizer`, for an Organizer's artists.
 *
 * `ArtistService.Search` is served by the backend's **admin** Connect server
 * (`api.admin`), which mounts the consumer ArtistService behind the admin-role
 * gate — see organizer-accounts design D2 (the higher-privilege admin server may
 * mount consumer read handlers as needed). This client therefore uses the same
 * authenticated {@link createAdminTransport} (`adminApiBaseUrl` + admin bearer
 * token) as the organizer client, so the admin console never makes a
 * cross-origin call to the consumer API and no separate consumer transport is
 * needed. Errors propagate so the caller can surface INVALID_ARGUMENT (query too
 * short) as user-facing copy.
 */
export class ArtistClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistClient')
	private readonly authService = resolve(IAuthService)
	private readonly transport = createAdminTransport(
		this.authService,
		resolve(ILogger).scopeTo('AdminTransport'),
		resolve(IAppConfig),
	)
	private readonly client = createClient(ArtistService, this.transport)
	private readonly adminClient = createClient(
		AdminArtistService,
		this.transport,
	)

	/** Returns artists whose name matches the query (local DB + external sources). */
	public async search(query: string, signal?: AbortSignal): Promise<Artist[]> {
		this.logger.info('Searching artists', { query })
		try {
			const response = await this.client.search({ query }, { signal })
			return response.artists
		} catch (err) {
			this.logger.warn('search failed', { query, error: err })
			throw err
		}
	}

	/**
	 * Registers an artist under the given name and music-catalog id (MBID) and
	 * returns it. A test artist passes a generated MBID the catalog does not
	 * know, so the server keeps the given name.
	 */
	public async create(
		name: string,
		mbid: string,
		signal?: AbortSignal,
	): Promise<Artist | undefined> {
		this.logger.info('Creating artist', { name, mbid })
		try {
			const response = await this.client.create(
				{ name: { value: name }, mbid: { value: mbid } },
				{ signal },
			)
			return response.artist
		} catch (err) {
			this.logger.warn('create failed', { name, mbid, error: err })
			throw err
		}
	}

	/**
	 * Returns the artists the organizer currently represents, read with the
	 * admin `ArtistService.ListByOrganizer`.
	 */
	public async listByOrganizer(
		organizerId: string,
		signal?: AbortSignal,
	): Promise<Artist[]> {
		this.logger.info('Listing organizer artists', { organizerId })
		try {
			const response = await this.adminClient.listByOrganizer(
				{ organizerId: { value: organizerId } },
				{ signal },
			)
			return response.artists
		} catch (err) {
			this.logger.warn('listByOrganizer failed', { organizerId, error: err })
			throw err
		}
	}
}
