import {
	type Artist,
	ArtistId,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const IArtistServiceClient = DI.createInterface<IArtistServiceClient>(
	'IArtistServiceClient',
	(x) => x.singleton(ArtistServiceClient),
)

export interface IArtistServiceClient extends ArtistServiceClient {}

export class ArtistServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistServiceClient')
	private readonly client: PromiseClient<typeof ArtistService>

	constructor() {
		this.logger.debug('Initializing ArtistServiceClient')

		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
		)

		this.client = createPromiseClient(ArtistService, transport)
	}

	public getClient(): PromiseClient<typeof ArtistService> {
		return this.client
	}

	/**
	 * Fetch top artists by country and optional genre tag.
	 */
	public async listTop(
		country: string,
		tag: string,
		limit: number,
	): Promise<Artist[]> {
		const resp = await this.client.listTop({ country, tag, limit })
		return resp.artists
	}

	/**
	 * Fetch artists similar to the given artist.
	 */
	public async listSimilar(artistId: string, limit: number): Promise<Artist[]> {
		const resp = await this.client.listSimilar({
			artistId: new ArtistId({ value: artistId }),
			limit,
		})
		return resp.artists
	}

	/**
	 * Search artists by query string.
	 */
	public async search(query: string): Promise<Artist[]> {
		const resp = await this.client.search({ query })
		return resp.artists
	}
}
