import { ArtistId } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import { DI, ILogger, resolve } from 'aurelia'
import { resolveStore } from '../state/store-interface'
import { IFollowServiceClient } from './follow-service-client'

export const IGuestDataMergeService =
	DI.createInterface<IGuestDataMergeService>('IGuestDataMergeService', (x) =>
		x.singleton(GuestDataMergeService),
	)

export interface IGuestDataMergeService extends GuestDataMergeService {}

export class GuestDataMergeService {
	private readonly logger = resolve(ILogger).scopeTo('GuestDataMergeService')
	private readonly followService = resolve(IFollowServiceClient)
	private readonly store = resolveStore()

	/**
	 * Merge all guest data into the authenticated user's account.
	 * Follows are best-effort: individual failures are logged but do not abort the merge.
	 * After merge, onboardingStep is set to COMPLETED and guest data is cleared.
	 */
	public async merge(): Promise<void> {
		const { follows } = this.store.getState().guest
		this.logger.info('Starting guest data merge', {
			artistCount: follows.length,
		})

		// Follow each artist (best-effort)
		const client = this.followService.getClient()
		for (const guestFollow of follows) {
			const artistId = guestFollow.artist.id?.value ?? ''
			const artistName = guestFollow.artist.name?.value ?? ''
			try {
				await client.follow({
					artistId: new ArtistId({ value: artistId }),
				})
				this.logger.debug('Followed artist', {
					id: artistId,
					name: artistName,
				})
			} catch (err) {
				this.logger.warn('Failed to follow artist during merge, continuing', {
					id: artistId,
					name: artistName,
					error: err,
				})
			}
		}

		// Clear guest data before marking onboarding as completed.
		this.store.dispatch({ type: 'guest/clearAll' })
		this.store.dispatch({ type: 'onboarding/complete' })
		this.logger.info('Guest data merge completed')
	}
}
