import { AppTask, IContainer, ILogger } from 'aurelia'
import { IAuthService } from './auth-service'
import { IFollowStore } from './follow-store'

/**
 * Start loading the signed-in fan's follow list as soon as the session is
 * known, without blocking start-up. Discovery picks its seeds from this list,
 * so a load that runs while the app boots saves a round trip before the first
 * similar-artist request. Exported apart from the `AppTask` so tests can run it.
 */
export function runFollowPrefetch(container: IContainer): void {
	const auth = container.get(IAuthService)
	const logger = container.get(ILogger).scopeTo('FollowPrefetchTask')
	void auth.ready.then(() => {
		if (!auth.isAuthenticated) return
		container
			.get(IFollowStore)
			.ensureLoaded()
			.catch((err: unknown) => {
				// Discovery retries through ensureLoaded; nothing to surface here.
				logger.warn('Follow prefetch failed', { error: err })
			})
	})
}

export const FollowPrefetchTask = AppTask.activating(
	IContainer,
	runFollowPrefetch,
)
