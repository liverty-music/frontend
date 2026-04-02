import { DI, ILogger, resolve } from 'aurelia'
import { IFollowRpcClient } from '../adapter/rpc/client/follow-client'
import { DEFAULT_HYPE } from '../entities/follow'
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
	 * Follows and hypes are best-effort: individual failures are logged but do not abort the merge.
	 * After merge, onboardingStep is set to COMPLETED and guest data is cleared.
	 */
	public async merge(): Promise<void> {
		const { follows } = this.guest
		const hypeCount = follows.filter((f) => f.hype !== DEFAULT_HYPE).length
		this.logger.info('Starting guest data merge', {
			artistCount: follows.length,
			hypeCount,
		})

		for (const follow of follows) {
			const artistId = follow.artist.id
			const artistName = follow.artist.name
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

		// Merge non-default hype levels (best-effort)
		for (const follow of follows) {
			if (follow.hype === DEFAULT_HYPE) continue
			const artistId = follow.artist.id
			try {
				await this.rpcClient.setHype(artistId, follow.hype)
				this.logger.debug('Hype merged', { artistId, hype: follow.hype })
			} catch (err) {
				this.logger.warn('Failed to set hype during merge, continuing', {
					artistId,
					hype: follow.hype,
					error: err,
				})
			}
		}

		this.guest.clearAll()
		this.onboarding.complete()
		this.logger.info('Guest data merge completed')
	}
}
