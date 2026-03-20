import { SearchStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import {
	IConcertRpcClient,
	type ProtoConcert,
	type ProximityGroup,
} from '../adapter/rpc/client/concert-client'
import { codeToHome } from '../constants/iso3166'
import type { SearchStatusResult } from '../routes/discovery/concert-search-tracker'
import { IGuestService } from './guest-service'
import { IOnboardingService } from './onboarding-service'

export type { ProtoConcert, ProximityGroup, SearchStatusResult }

export const IConcertService = DI.createInterface<IConcertService>(
	'IConcertService',
	(x) => x.singleton(ConcertServiceClient),
)

export interface IConcertService extends ConcertServiceClient {}

export class ConcertServiceClient {
	private readonly logger = resolve(ILogger).scopeTo('ConcertService')
	private readonly guest = resolve(IGuestService)
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
		const { follows, home: homeCode } = this.guest
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

	public async verifyConcertsExist(
		artistIds: string[],
		signal?: AbortSignal,
	): Promise<boolean> {
		if (artistIds.length === 0) return false
		this.logger.info('Verifying concerts exist for artists', {
			count: artistIds.length,
		})
		const results = await Promise.all(
			artistIds.map((id) =>
				this.rpcClient.listConcerts(id, signal).catch(() => []),
			),
		)
		return results.some((concerts) => concerts.length > 0)
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
	): Promise<SearchStatusResult[]> {
		const statuses = await this.rpcClient.listSearchStatuses(artistIds, signal)
		return statuses.map((s) => ({
			artistId: s.artistId?.value ?? '',
			status: protoStatusToString(s.status),
		}))
	}
}

function protoStatusToString(
	status: SearchStatus,
): SearchStatusResult['status'] {
	switch (status) {
		case SearchStatus.PENDING:
			return 'pending'
		case SearchStatus.COMPLETED:
			return 'completed'
		case SearchStatus.FAILED:
			return 'failed'
		default:
			return 'unspecified'
	}
}
