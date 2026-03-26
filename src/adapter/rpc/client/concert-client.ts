import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert as ProtoConcert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { Home } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import type { ProximityGroup } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from '../../../services/auth-service'
import { createTransport } from '../../../services/grpc-transport'

export type { ProtoConcert, ProximityGroup }

export const IConcertRpcClient = DI.createInterface<IConcertRpcClient>(
	'IConcertRpcClient',
	(x) => x.singleton(ConcertRpcClient),
)

export interface IConcertRpcClient extends ConcertRpcClient {}

export class ConcertRpcClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertRpcClient')
	private readonly authService = resolve(IAuthService)
	private readonly client = createClient(
		ConcertService,
		createTransport(this.authService, resolve(ILogger).scopeTo('Transport')),
	)

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ProtoConcert[]> {
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

	public async listByFollower(signal?: AbortSignal): Promise<ProximityGroup[]> {
		this.logger.info('Listing concerts by follower')
		try {
			const response = await this.client.listByFollower({}, { signal })
			return response.groups
		} catch (err) {
			this.logger.warn('Concert listByFollower failed', { error: err })
			throw err
		}
	}

	public async listWithProximity(
		artistIds: string[],
		countryCode: string,
		level1: string,
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const response = await this.client.listWithProximity(
			{
				artistIds: artistIds.map((id) => new ArtistId({ value: id })),
				home: new Home({ countryCode, level1 }),
			},
			{ signal },
		)
		return response.groups
	}

}
