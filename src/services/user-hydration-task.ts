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

	// Capture once: i18n.setLocale isn't called between here and the backfill
	// branch, so the effective locale stays stable. Reusing the value also
	// guarantees that ensureLoaded's Create-on-cache-miss path and the
	// backfill RPC send identical strings.
	const clientLocale = i18n.getLocale()

	try {
		await userService.ensureLoaded(clientLocale)
	} catch (err) {
		logger.warn('Failed to hydrate user profile, continuing without it', {
			error: err,
		})
		return
	}

	// After hydration, the DB becomes the source of truth for the active
	// locale. Translation bundles for `ja` and `en` are statically imported
	// in main.ts, so i18n.setLocale is synchronous from a network standpoint
	// and is safe to call on the activating-task hot path.
	const current = userService.current
	if (!current) return

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
		// Legacy NULL row: backfill once per tab so flaky connections don't
		// hammer the backend across cold starts.
		try {
			await userService.updatePreferredLanguage(clientLocale)
			sessionStorage.setItem(SessionKeys.languageBackfillAttempted, '1')
			logger.info('Backfilled preferred_language', { lang: clientLocale })
		} catch (err) {
			logger.warn(
				'Failed to backfill preferred_language; will retry on next session',
				{ error: err, lang: clientLocale },
			)
		}
	}

	// removeItem is a safe no-op when the key is absent and only throws when
	// localStorage has been monkey-patched, which we don't defend against.
	localStorage.removeItem(StorageKeys.language)
}

export const UserHydrationTask = AppTask.activating(
	IContainer,
	runUserHydration,
)
