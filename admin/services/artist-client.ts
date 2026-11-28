import {
	type Artist,
	ArtistMbidStatus,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService as AdminArtistService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/artist/v1/artist_service_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/artist/v1/artist_service_pb.js'
import { Code, ConnectError, createClient } from '@connectrpc/connect'
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
 * Admin-local wrapper for the Artist calls of the admin console:
 * `ArtistService.Search`, to pick an artist to associate, and the admin
 * `ArtistService.Create`, to register a test artist,
 * `ArtistService.ListByOrganizer` and `ArtistService.Get`, for an
 * Organizer's artists and for one artist opened by id, and
 * `ArtistService.ListByMbidStatus` and `ArtistService.CorrectMbid`, for the
 * Artist MBIDs screen.
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
	 * Returns one artist by its id, read with the admin `ArtistService.Get`, or
	 * null when no artist has the id (the server answers NotFound). Other
	 * failures reject.
	 */
	public async get(
		artistId: string,
		signal?: AbortSignal,
	): Promise<Artist | null> {
		this.logger.info('Getting artist', { artistId })
		try {
			const response = await this.adminClient.get(
				{ artistId: { value: artistId } },
				{ signal },
			)
			return response.artist ?? null
		} catch (err) {
			if (ConnectError.from(err).code === Code.NotFound) return null
			this.logger.warn('get failed', { artistId, error: err })
			throw err
		}
	}

	/**
	 * Registers an artist under the given name and music-catalog id (MBID)
	 * with the admin `ArtistService.Create` and returns it. A test artist
	 * passes a generated MBID the catalog does not know, so the server keeps
	 * the given name.
	 */
	public async create(
		name: string,
		mbid: string,
		signal?: AbortSignal,
	): Promise<Artist | undefined> {
		this.logger.info('Creating artist', { name, mbid })
		try {
			const response = await this.adminClient.create(
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

	/**
	 * Returns the artists whose MBID could not be verified automatically
	 * (Ambiguous), oldest first, read with the admin
	 * `ArtistService.ListByMbidStatus`.
	 */
	public async listAmbiguous(signal?: AbortSignal): Promise<Artist[]> {
		this.logger.info('Listing ambiguous artists')
		try {
			const response = await this.adminClient.listByMbidStatus(
				{ mbidStatus: ArtistMbidStatus.AMBIGUOUS },
				{ signal },
			)
			return response.artists
		} catch (err) {
			this.logger.warn('listAmbiguous failed', { error: err })
			throw err
		}
	}

	/**
	 * Gives the artist the MBID an admin chose with the admin
	 * `ArtistService.CorrectMbid` and returns the corrected artist. Errors
	 * (AlreadyExists, NotFound) propagate for the caller to explain.
	 */
	public async correctMbid(
		artistId: string,
		mbid: string,
		signal?: AbortSignal,
	): Promise<Artist | undefined> {
		this.logger.info('Correcting artist MBID', { artistId, mbid })
		try {
			const response = await this.adminClient.correctMbid(
				{ artistId: { value: artistId }, mbid: { value: mbid } },
				{ signal },
			)
			return response.artist
		} catch (err) {
			this.logger.warn('correctMbid failed', { artistId, mbid, error: err })
			throw err
		}
	}
}
