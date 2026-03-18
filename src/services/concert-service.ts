import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Concert } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/concert_pb.js'
import {
	type ArtistSearchStatus,
	ProximityGroup,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/rpc/concert/v1/concert_service_pb.js'
import { ConcertService } from '@buf/liverty-music_schema.connectrpc_es/liverty_music/rpc/concert/v1/concert_service_connect.js'
import { createClient } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
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
	 * During onboarding, read artist IDs from LocalArtistClient and call
	 * ConcertService/List per artist (public RPC), merging results.
	 * Groups all concerts into the "away" lane since no home is set.
	 */
	private async listByFollowerOnboarding(
		signal?: AbortSignal,
	): Promise<ProximityGroup[]> {
		const artists = this.store.getState().guest.follows
		this.logger.info('Onboarding: listing concerts for local artists', {
			count: artists.length,
		})
		const results = await Promise.allSettled(
			artists.map((a) => this.listConcerts(a.artist.id?.value ?? '', signal)),
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
		return groupConcertsByDate(concerts)
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

/**
 * Groups a flat list of concerts by date into ProximityGroup messages.
 * All concerts are placed in the "away" lane (used during onboarding when
 * no server-side grouping is available).
 */
function groupConcertsByDate(concerts: Concert[]): ProximityGroup[] {
	const groups = new Map<string, ProximityGroup>()
	for (const concert of concerts) {
		const ld = concert.localDate?.value
		if (!ld) continue
		const key = `${ld.year}-${String(ld.month).padStart(2, '0')}-${String(ld.day).padStart(2, '0')}`
		let group = groups.get(key)
		if (!group) {
			group = new ProximityGroup({ date: concert.localDate })
			groups.set(key, group)
		}
		group.away.push(concert)
	}
	return Array.from(groups.values()).sort((a, b) => {
		const ad = a.date?.value
		const bd = b.date?.value
		if (!ad || !bd) return 0
		return ad.year - bd.year || ad.month - bd.month || ad.day - bd.day
	})
}
