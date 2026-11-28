import type { CatalogArtist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/catalog_artist_pb.js'
import { CatalogArtistService } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/admin/catalog_artist/v1/catalog_artist_service_pb.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import { IAuthService } from '../../shared/services/auth-service'
import { createAdminTransport } from './admin-transport'

export type { CatalogArtist }

export const ICatalogArtistClient = DI.createInterface<ICatalogArtistClient>(
	'ICatalogArtistClient',
	(x) => x.singleton(CatalogArtistClient),
)

export interface ICatalogArtistClient extends CatalogArtistClient {}

/**
 * Admin-local wrapper for the admin `CatalogArtistService`: the music
 * catalog's artists that share a registered artist's name, for the Artist
 * MBIDs screen. Errors propagate so the screen can offer a retry.
 */
export class CatalogArtistClient {
	private readonly logger = resolve(ILogger).scopeTo('CatalogArtistClient')
	private readonly client = createClient(
		CatalogArtistService,
		createAdminTransport(
			resolve(IAuthService),
			resolve(ILogger).scopeTo('AdminTransport'),
			resolve(IAppConfig),
		),
	)

	/**
	 * Returns the artist's namesake candidates in the server's order: its
	 * current MBID first when the name search did not find it.
	 */
	public async listByArtist(
		artistId: string,
		signal?: AbortSignal,
	): Promise<CatalogArtist[]> {
		this.logger.info('Listing namesakes', { artistId })
		try {
			const response = await this.client.listByArtist(
				{ artistId: { value: artistId } },
				{ signal },
			)
			return response.catalogArtists
		} catch (err) {
			this.logger.warn('listByArtist failed', { artistId, error: err })
			throw err
		}
	}
}
