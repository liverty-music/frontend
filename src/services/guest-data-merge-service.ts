import { DI, ILogger, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import { IGuestService } from './guest-service'
import { IOnboardingService } from './onboarding-service'

export const IGuestDataMergeService =
	DI.createInterface<IGuestDataMergeService>('IGuestDataMergeService', (x) =>
		x.singleton(GuestDataMergeService),
	)

export interface IGuestDataMergeService extends GuestDataMergeService {}

export class GuestDataMergeService {
	private readonly logger = resolve(ILogger).scopeTo('GuestDataMergeService')
	private readonly rpcClient = resolve(IFollowRpcClient)
	private readonly guest = resolve(IGuestService)
	private readonly onboarding = resolve(IOnboardingService)

	/**
	 * Merge all guest data into the authenticated user's account.
	 * Follows are best-effort: individual failures are logged but do not abort the merge.
	 * After merge, onboardingStep is set to COMPLETED and guest data is cleared.
	 */
	public async merge(): Promise<void> {
		const { follows } = this.guest
		this.logger.info('Starting guest data merge', {
			artistCount: follows.length,
		})

		for (const guestFollow of follows) {
			const artistId = guestFollow.artist.id
			const artistName = guestFollow.artist.name
			try {
				await this.rpcClient.follow(artistId)
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

		this.guest.clearAll()
		this.onboarding.complete()
		this.logger.info('Guest data merge completed')
	}
}
