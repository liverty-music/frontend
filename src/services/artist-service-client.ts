import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { ArtistService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/artist/v1/artist_service_connect.js'
import { createPromiseClient, type PromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export interface ArtistBubble {
	id: string
	name: string
	mbid: string
	imageUrl: string
	x: number
	y: number
	radius: number
}

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
	): Promise<ArtistBubble[]> {
		const resp = await this.client.listTop({ country, tag, limit })
		return resp.artists.map((a) => toBubble(a))
	}

	/**
	 * Fetch artists similar to the given artist.
	 */
	public async listSimilar(
		artistId: string,
		limit: number,
	): Promise<ArtistBubble[]> {
		const resp = await this.client.listSimilar({
			artistId: new ArtistId({ value: artistId }),
			limit,
		})
		return resp.artists.map((a) => toBubble(a))
	}

	/**
	 * Search artists by query string.
	 */
	public async search(query: string): Promise<ArtistBubble[]> {
		const resp = await this.client.search({ query })
		return resp.artists.map((a) => toBubble(a))
	}
}

function toBubble(artist: {
	id?: { value: string }
	name?: { value: string }
	mbid?: { value: string }
}): ArtistBubble {
	const id = artist.id?.value ?? ''
	const name = artist.name?.value ?? ''
	const mbid = artist.mbid?.value ?? ''
	return {
		id: id || mbid || crypto.randomUUID(),
		name,
		mbid,
		imageUrl: '',
		x: 0,
		y: 0,
		radius: 30 + Math.random() * 15,
	}
}
