import { DI, ILogger, resolve } from 'aurelia'
import {
	type ArtistSearchStatus,
	IConcertRpcClient,
	type ProtoConcert,
	type ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { codeToHome } from '../constants/iso3166'
import { resolveStore } from '../state/store-interface'
import { IOnboardingService } from './onboarding-service'

export type { ArtistSearchStatus, ProtoConcert, ProximityGroup }

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly store = resolveStore()
	private readonly onboarding = resolve(IOnboardingService)
	private readonly rpcClient = resolve(IConcertRpcClient)

	public async listConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<ProtoConcert[]> {
		return this.rpcClient.listConcerts(artistId, signal)
	}

	public async listByFollower(signal?: AbortSignal): Promise<ProximityGroup[]> {
		if (this.onboarding.isOnboarding) {
			return this.listByFollowerOnboarding(signal)
		}
		return this.rpcClient.listByFollower(signal)
	}

	private async listByFollowerOnboarding(
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const { follows, home: homeCode } = this.store.getState().guest
		this.logger.info('Onboarding: listing concerts with proximity', {
			count: follows.length,
		})
		if (follows.length === 0 || !homeCode) return []

		const { countryCode, level1 } = codeToHome(homeCode)
		return this.rpcClient.listWithProximity(
			follows.map((a) => a.artist.id),
			countryCode,
			level1,
			signal,
		)
	}

	public async searchNewConcerts(
		artistId: string,
		signal?: AbortSignal,
	): Promise<void> {
		await this.rpcClient.searchNewConcerts(artistId, signal)
	}

	public async listSearchStatuses(
		artistIds: string[],
		signal?: AbortSignal,
	): Promise<ArtistSearchStatus[]> {
		return this.rpcClient.listSearchStatuses(artistIds, signal)
	}
}
