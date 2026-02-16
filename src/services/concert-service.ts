import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js'
import { type PromiseClient, createPromiseClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly client: PromiseClient<typeof ConcertService>

	constructor() {
		const authService = resolve(IAuthService)
		this.client = createPromiseClient(ConcertService, createTransport(authService))
	}

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<Concert[]> {
		this.logger.info('Listing concerts', { artistId })
		try {
			const response = await this.client.list(
				{
					artistId: new ArtistId({ value: artistId }),
				},
				{ signal },
			)
			return response.concerts
		} catch (err) {
			this.logger.warn('Concert list failed', { artistId, error: err })
			throw err
		}
	}

	public async searchNewConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Searching for new concerts', { artistId })
		try {
			await this.client.searchNewConcerts(
				{
					artistId: new ArtistId({ value: artistId }),
				},
				{ signal },
			)
			this.logger.info('Concert search completed', { artistId })
		} catch (err) {
			this.logger.warn('Concert search failed', { artistId, error: err })
			throw err
		}
	}
}
