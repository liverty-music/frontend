import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { createConsumerPublicTransport } from './consumer-public-transport'

export type { Artist }

export const IArtistSearchClient = DI.createInterface<IArtistSearchClient>(
	'IArtistSearchClient',
	(x) => x.singleton(ArtistSearchClient),
)

export interface IArtistSearchClient extends ArtistSearchClient {}

/**
 * Admin-local wrapper around the PUBLIC consumer `ArtistService.Search` RPC.
 *
 * The organizer screen reuses artist search to pick an artist to associate.
 * Since the admin app has no artist-search surface of its own, and importing the
 * consumer `src/` is forbidden by the bundle-isolation rule, this wrapper calls
 * the public Search procedure directly over an admin-local transport pointed at
 * the CONSUMER host (Search is served by the consumer server, not the admin
 * server). Errors propagate so the caller can surface INVALID_ARGUMENT (query
 * too short) as user-facing copy.
 */
export class ArtistSearchClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistSearchClient')
	private readonly client = createClient(
		ArtistService,
		createConsumerPublicTransport(resolve(IAppConfig)),
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
