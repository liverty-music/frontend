import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import { Home } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/user_pb.js'
import type {
	ArtistSearchStatus,
	ProximityGroup,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { codeToHome } from '../constants/iso3166'
import { resolveStore } from '../state/store-interface'
import { IAuthService } from './auth-service'
import { createTransport } from './grpc-transport'
import { IOnboardingService } from './onboarding-service'

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly authService = resolve(IAuthService)
	private readonly store = resolveStore()
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

	public async listByFollower(signal?: AbortSignal): Promise<ProximityGroup[]> {
		if (this.onboarding.isOnboarding) {
			return this.listByFollowerOnboarding(signal)
		}
		this.logger.info('Listing concerts by follower')
		try {
			const response = await this.concertClient.listByFollower({}, { signal })
			return response.groups
		} catch (err) {
			this.logger.warn('Concert listByFollower failed', { error: err })
			throw err
		}
	}

	/**
	 * During onboarding, call ListWithProximity with the guest's followed
	 * artist IDs and selected home for server-side proximity classification.
	 */
	private async listByFollowerOnboarding(
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const { follows, home: homeCode } = this.store.getState().guest
		this.logger.info('Onboarding: listing concerts with proximity', {
			count: follows.length,
		})
		if (follows.length === 0 || !homeCode) return []

		const { countryCode, level1 } = codeToHome(homeCode)
		const response = await this.concertClient.listWithProximity(
			{
				artistIds: follows.map(
					(a) => new ArtistId({ value: a.artist.id?.value ?? '' }),
				),
				home: new Home({ countryCode, level1 }),
			},
			{ signal },
		)
		return response.groups
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

	public async listSearchStatuses(
		artistIds: string[],
		signal?: AbortSignal,
	): Promise<ArtistSearchStatus[]> {
		this.logger.info('Polling search statuses', { count: artistIds.length })
		try {
			const response = await this.concertClient.listSearchStatuses(
				{
					artistIds: artistIds.map((id) => new ArtistId({ value: id })),
				},
				{ signal },
			)
			return response.statuses
		} catch (err) {
			this.logger.warn('ListSearchStatuses failed', { error: err })
			throw err
		}
	}
}
