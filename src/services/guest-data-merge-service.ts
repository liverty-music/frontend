import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { HypeType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import { IFollowServiceClient } from './follow-service-client'
import {
	ILocalArtistClient,
	type LocalFollowedArtist,
} from './local-artist-client'
import { IOnboardingService } from './onboarding-service'

export const IGuestDataMergeService =
	DI.createInterface<IGuestDataMergeService>('IGuestDataMergeService', (x) =>
		x.singleton(GuestDataMergeService),
	)

export interface IGuestDataMergeService extends GuestDataMergeService {}

export class GuestDataMergeService {
	private readonly logger = resolve(ILogger).scopeTo('GuestDataMergeService')
	private readonly followService = resolve(IFollowServiceClient)
	private readonly localClient = resolve(ILocalArtistClient)
	private readonly onboarding = resolve(IOnboardingService)

	/**
	 * Merge all guest data into the authenticated user's account.
	 * Follows are best-effort: individual failures are logged but do not abort the merge.
	 * After merge, onboardingStep is set to COMPLETED and guest data is cleared.
	 */
	public async merge(): Promise<void> {
		const artists = this.localClient.listFollowed()
		this.logger.info('Starting guest data merge', {
			artistCount: artists.length,
		})

		// Follow each artist (best-effort)
		const client = this.followService.getClient()
		for (const artist of artists) {
			try {
				await client.follow({
					artistId: new ArtistId({ value: artist.id }),
				})
				this.logger.debug('Followed artist', {
					id: artist.id,
					name: artist.name,
				})
			} catch (err) {
				this.logger.warn('Failed to follow artist during merge, continuing', {
					id: artist.id,
					name: artist.name,
					error: err,
				})
			}
		}

		// Set hype (best-effort)
		for (const artist of artists) {
			const hype = this.mapHype(artist.hype)
			if (hype === HypeType.ANYWHERE) {
				// AWAY is the default, skip the RPC
				continue
			}
			try {
				await client.setHype({
					artistId: new ArtistId({ value: artist.id }),
					hype,
				})
				this.logger.debug('Set hype', {
					id: artist.id,
					hype: artist.hype,
				})
			} catch (err) {
				this.logger.warn('Failed to set hype during merge, continuing', {
					id: artist.id,
					error: err,
				})
			}
		}

		// Clear guest data before marking onboarding as completed.
		// If clearAll() throws, the step remains SIGNUP so the merge can retry.
		this.localClient.clearAll()
		this.onboarding.complete()
		this.logger.info('Guest data merge completed')
	}

	private mapHype(level: LocalFollowedArtist['hype']): HypeType {
		switch (level) {
			case 'WATCH':
				return HypeType.WATCH
			case 'HOME':
				return HypeType.HOME
			case 'AWAY':
				return HypeType.ANYWHERE
			default:
				return HypeType.ANYWHERE
		}
	}
}
