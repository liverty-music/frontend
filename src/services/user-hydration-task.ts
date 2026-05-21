import { I18N } from '@aurelia/i18n'
import { AppTask, IContainer, ILogger } from 'aurelia'
import { SessionKeys, StorageKeys } from '../constants/storage-keys'
import { IAuthService } from './auth-service'
import { IUserService } from './user-service'

/**
 * Runs the authenticated boot sequence:
 *   1. Wait for auth readiness.
 *   2. Hydrate `UserService.current` via `ensureLoaded` (Get or idempotent Create).
 *   3. Apply `current.preferredLanguage` to i18n, or backfill it from the
 *      currently effective locale when the row has no preference yet.
 *   4. Remove the legacy `localStorage['language']` key — the DB is the source
 *      of truth from this point on for authenticated sessions.
 *
 * Exported separately from the `AppTask` wrapper so unit tests can drive the
 * full hydration flow with stubbed services.
 */
export async function runUserHydration(container: IContainer): Promise<void> {
	const auth = container.get(IAuthService)
	await auth.ready

	if (!auth.isAuthenticated) return

	const userService = container.get(IUserService)
	const logger = container.get(ILogger).scopeTo('UserHydrationTask')
	const i18n = container.get(I18N)

	try {
		// Pass the current effective locale into ensureLoaded so its
		// Create-on-cache-miss recovery path has the value it needs. Keeping
		// the locale as a parameter avoids coupling UserService to I18N.
		await userService.ensureLoaded(i18n.getLocale())
	} catch (err) {
		logger.warn('Failed to hydrate user profile, continuing without it', {
			error: err,
		})
		return
	}

	// After hydration, the DB becomes the source of truth for the active
	// locale. Three branches:
	//   1. User has a stored preferred_language -> apply to i18n.
	//   2. User row has no preferred_language (legacy NULL) -> backfill by
	//      persisting the currently effective locale; bound retries to one
	//      per session so a flaky connection doesn't hammer the backend on
	//      every cold start.
	//   3. No user (unlikely here because ensureLoaded resolved) -> skip.
	const current = userService.current
	if (current) {
		if (current.preferredLanguage) {
			try {
				await i18n.setLocale(current.preferredLanguage)
			} catch (err) {
				logger.warn('Failed to apply preferred language to i18n', {
					error: err,
					lang: current.preferredLanguage,
				})
			}
		} else if (!sessionStorage.getItem(SessionKeys.languageBackfillAttempted)) {
			const effective = i18n.getLocale()
			try {
				await userService.updatePreferredLanguage(effective)
				sessionStorage.setItem(SessionKeys.languageBackfillAttempted, '1')
				logger.info('Backfilled preferred_language', { lang: effective })
			} catch (err) {
				logger.warn(
					'Failed to backfill preferred_language; will retry on next session',
					{ error: err, lang: effective },
				)
			}
		}
	}

	// Cleanup the legacy localStorage key in all cases — once authenticated,
	// no code path should read it again. removeItem is a safe no-op when the
	// key is already absent and only throws in environments where localStorage
	// has been monkey-patched, which is not a case we need to defend against.
	localStorage.removeItem(StorageKeys.language)
}

export const UserHydrationTask = AppTask.activating(
	IContainer,
	runUserHydration,
)
