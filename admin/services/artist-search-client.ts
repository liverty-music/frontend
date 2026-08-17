import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { Artist }

export const IArtistSearchClient = DI.createInterface<IArtistSearchClient>(
	'IArtistSearchClient',
	(x) => x.singleton(ArtistSearchClient),
)

export interface IArtistSearchClient extends ArtistSearchClient {}

/**
 * Admin-local wrapper around `ArtistService.Search`, used by the organizer
 * screen to pick an artist to associate.
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
export class ArtistSearchClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistSearchClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ArtistService,
		createAdminTransport(
			this.authService,
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
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
}
