import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import type { Artist } from '../../../entities/artist'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'
import { artistFrom } from '../mapper/artist-mapper'

export const IArtistRpcClient = DI.createInterface<IArtistRpcClient>(
	'IArtistRpcClient',
	(x) => x.singleton(ArtistRpcClient),
)

export interface IArtistRpcClient extends ArtistRpcClient {}

export class ArtistRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('ArtistRpcClient')
	private readonly client: PromiseClient<typeof ArtistService>

	constructor() {
		this.logger.debug('Initializing ArtistRpcClient')

		const authService = resolve(IAuthService)
		const transport = createTransport(
			authService,
			resolve(ILogger).scopeTo('Transport'),
		)

		this.client = createPromiseClient(ArtistService, transport)
	}

	public async listTop(
		country: string,
		tag: string,
		limit: number,
	): Promise<Artist[]> {
		const resp = await this.client.listTop({ country, tag, limit })
		return resp.artists.map(artistFrom)
	}

	public async listSimilar(artistId: string, limit: number): Promise<Artist[]> {
		const resp = await this.client.listSimilar({
			artistId: new ArtistId({ value: artistId }),
			limit,
		})
		return resp.artists.map(artistFrom)
	}

	public async search(query: string): Promise<Artist[]> {
		const resp = await this.client.search({ query })
		return resp.artists.map(artistFrom)
	}
}
