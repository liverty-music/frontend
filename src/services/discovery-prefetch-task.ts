import { AppTask, IContainer, ILogger } from 'aurelia'
import { IArtistBubbleStore } from './artist-bubble-store'
import { IAuthService } from './auth-service'
import { IFollowStore } from './follow-store'
import { IOnboardingService } from './onboarding-service'
import { opensOnDiscovery } from './user-hydration-task'

/**
 * For an app opened on Discovery, start building the bubble field during
 * start-up instead of when the route loads: once the session is known (and,
 * for a signed-in fan, the follow list), the initial load runs while the app
 * shell and route are still being set up, so the similar-artist (or top
 * artist) round trip overlaps with them. Does not block start-up. The route's
 * own load reuses the field, or the load still in flight.
 */
export function runDiscoveryPrefetch(
	container: IContainer,
	pathname: string,
	viewportWidth: number,
): void {
	if (!opensOnDiscovery(pathname)) return
	const auth = container.get(IAuthService)
	const follows = container.get(IFollowStore)
	const onboarding = container.get(IOnboardingService)
	const bubbles = container.get(IArtistBubbleStore)
	const logger = container.get(ILogger).scopeTo('DiscoveryPrefetchTask')
	void (async () => {
		await auth.ready
		if (auth.isAuthenticated) {
			// The list kept from the last start lets the seeds go out now, in
			// parallel with this session's follow list (which waits behind the
			// app's start-up on the main thread). The field still drops what the
			// fresh list follows when it is set.
			const kept = follows.keptFollowedArtists()
			if (kept.length > 0) {
				bubbles.prefetchInitial(viewportWidth, kept)
				return
			}
			await follows.ensureLoaded()
		} else if (onboarding.isOnboarding && follows.guestFollows.length > 0) {
			// The route's loading() prelude does the same for onboarding guests.
			follows.hydrate(follows.guestFollows.map((f) => f.artist))
		}
		bubbles.prefetchInitial(viewportWidth)
	})().catch((err: unknown) => {
		// The route loads the field itself and reports a failure.
		logger.warn('Discovery start-up load failed', { error: err })
	})
}

export const DiscoveryPrefetchTask = AppTask.activating(
	IContainer,
	(container: IContainer) =>
		runDiscoveryPrefetch(
			container,
			window.location.pathname,
			window.innerWidth,
		),
)
