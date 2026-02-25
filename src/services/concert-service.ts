import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { ILocalArtistClient } from './local-artist-client'
import { IOnboardingService } from './onboarding-service'

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly authService = resolve(IAuthService)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly concertClient = createClient(
		ConcertService,
		createTransport(this.authService, resolve(ILogger).scopeTo('Transport')),
	)

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<Concert[]> {
		this.logger.info('Listing concerts', { artistId })
		try {
			const response = await this.concertClient.list(
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

	public async listByFollower(signal?: AbortSignal): Promise<Concert[]> {
		if (this.onboarding.isOnboarding) {
			return this.listByFollowerOnboarding(signal)
		}
		this.logger.info('Listing concerts by follower')
		try {
			const response = await this.concertClient.listByFollower({}, { signal })
			return response.concerts
		} catch (err) {
			this.logger.warn('Concert listByFollower failed', { error: err })
			throw err
		}
	}

	/**
	 * During onboarding, read artist IDs from LocalArtistClient and call
	 * ConcertService/List per artist (public RPC), merging results.
	 */
	private async listByFollowerOnboarding(
		signal?: AbortSignal,
	): Promise<Concert[]> {
		const artists = this.localClient.listFollowed()
		this.logger.info('Onboarding: listing concerts for local artists', {
			count: artists.length,
		})
		const results = await Promise.allSettled(
			artists.map((a) => this.listConcerts(a.id, signal)),
		)
		const concerts: Concert[] = []
		for (const result of results) {
			if (result.status === 'fulfilled') {
				concerts.push(...result.value)
			} else {
				this.logger.warn('Onboarding: concert list failed for an artist', {
					error: result.reason,
				})
			}
		}
		return concerts
	}

	public async searchNewConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		this.logger.info('Searching for new concerts', { artistId })
		try {
			await this.concertClient.searchNewConcerts(
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
