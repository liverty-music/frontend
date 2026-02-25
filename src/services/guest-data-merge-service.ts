import {
	ArtistId,
	PassionLevel,
} from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import { IArtistServiceClient } from './artist-service-client'
import {
	type LocalFollowedArtist,
	ILocalArtistClient,
} from './local-artist-client'
import { IOnboardingService } from './onboarding-service'

export const IGuestDataMergeService =
	DI.createInterface<IGuestDataMergeService>('IGuestDataMergeService', (x) =>
		x.singleton(GuestDataMergeService),
	)

export interface IGuestDataMergeService extends GuestDataMergeService {}

export class GuestDataMergeService {
	private readonly logger = resolve(ILogger).scopeTo('GuestDataMergeService')
	private readonly artistService = resolve(IArtistServiceClient)
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
		const client = this.artistService.getClient()
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

		// Set passion levels (best-effort)
		for (const artist of artists) {
			const level = this.mapPassionLevel(artist.passionLevel)
			if (level === PassionLevel.LOCAL_ONLY) {
				// LOCAL_ONLY is the default, skip the RPC
				continue
			}
			try {
				await client.setPassionLevel({
					artistId: new ArtistId({ value: artist.id }),
					passionLevel: level,
				})
				this.logger.debug('Set passion level', {
					id: artist.id,
					level: artist.passionLevel,
				})
			} catch (err) {
				this.logger.warn(
					'Failed to set passion level during merge, continuing',
					{
						id: artist.id,
						error: err,
					},
				)
			}
		}

		// Mark onboarding as completed and clear guest data
		this.onboarding.complete()
		this.localClient.clearAll()
		this.logger.info('Guest data merge completed')
	}

	private mapPassionLevel(
		level: LocalFollowedArtist['passionLevel'],
	): PassionLevel {
		switch (level) {
			case 'MUST_GO':
				return PassionLevel.MUST_GO
			case 'LOCAL_ONLY':
				return PassionLevel.LOCAL_ONLY
			case 'KEEP_AN_EYE':
				return PassionLevel.KEEP_AN_EYE
			default:
				return PassionLevel.LOCAL_ONLY
		}
	}
}
