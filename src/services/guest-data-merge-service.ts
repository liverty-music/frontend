import { DI, ILogger, resolve } from 'aurelia'
import { IGuestService } from './guest-service'
import { IOnboardingService } from './onboarding-service'

export const IGuestDataMergeService =
	DI.createInterface<IGuestDataMergeService>('IGuestDataMergeService', (x) =>
		x.singleton(GuestDataMergeService),
	)

export interface IGuestDataMergeService extends GuestDataMergeService {}

export class GuestDataMergeService {
	private readonly logger = resolve(ILogger).scopeTo('GuestDataMergeService')
	private readonly guest = resolve(IGuestService)
	private readonly onboarding = resolve(IOnboardingService)

	/**
	 * Complete the sign-up onboarding hand-off.
	 *
	 * Phase 2 hand-over: the follow + hype migration that used to live here is
	 * now owned SOLELY by `FollowStore`, triggered by the
	 * `GuestMigrationRequested` event that `AuthCallbackRoute` publishes on every
	 * successful authenticated callback. This method
	 * is reduced to its
	 * remaining non-follow orchestration so migration happens exactly once via
	 * a single path (the receipt + idempotent backend calls are only a safety
	 * net). Deleting this service entirely (and the onboarding-completion
	 * orchestration) is deferred to Phase 4.
	 *
	 * It MUST NOT clear the guest follow queue: FollowStore drains it per-item
	 * in the background as each `Follow` succeeds, and wiping it here would
	 * strand the in-flight migration. Home/language (UserStore's slice) ARE
	 * cleared here to preserve the existing sign-up behavior until UserStore
	 * absorbs `create()` in a later phase.
	 */
	public async merge(): Promise<void> {
		this.logger.info('Completing guest onboarding hand-off')
		// Clear only the home/language/help-seen guest preferences. Follows are
		// intentionally retained for FollowStore's GuestMigrationRequested-driven drain.
		this.guest.clearOnboardingExceptFollows()
		this.onboarding.complete()
		this.logger.info('Guest onboarding hand-off completed')
	}
}
