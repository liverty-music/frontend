import type { I18N } from '@aurelia/i18n'
import { StorageKeys } from '../constants/storage-keys'
import type { IAuthService } from '../services/auth-service'
import type { IUserService } from '../services/user-service'

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const

/**
 * Minimal logger surface accepted by `changeLocale`. The full `ILogger`
 * satisfies this — passing a scoped logger keeps the utility decoupled
 * from Aurelia's container while still routing warnings through the
 * project's structured log sink (and thus to OTel-forwarded telemetry).
 */
export interface ChangeLocaleLogger {
	warn(message: string, ...detail: unknown[]): void
}

/**
 * Dependencies required by the shared language-change utility. Components
 * pass these in via `resolve()` rather than the utility resolving them itself
 * so the function remains a plain utility (no DI side effects) and tests can
 * inject lightweight stubs.
 */
export interface ChangeLocaleDeps {
	readonly i18n: I18N
	readonly auth: IAuthService
	readonly userService: IUserService
	readonly logger?: ChangeLocaleLogger
}

/**
 * Shared entry point for changing the active locale.
 *
 * Routes persistence based on the caller's auth state, as required by the
 * `frontend-i18n` and `settings` specs:
 *
 * - **Unauthenticated** (Welcome page, landing): write through to
 *   `localStorage['language']` after `i18n.setLocale`. No backend call.
 *
 * - **Authenticated** (Settings page): call `UpdatePreferredLanguage` first,
 *   apply `i18n.setLocale` only on success, and NEVER touch
 *   `localStorage['language']`. The DB is the source of truth post-signup,
 *   and the hydration task is responsible for clearing the legacy key.
 *
 * On RPC failure, the function rethrows so the caller can surface a
 * user-visible error (Snack) and keep the prior locale active.
 */
export async function changeLocale(
	deps: ChangeLocaleDeps,
	lang: string,
): Promise<void> {
	const { i18n, auth, userService } = deps

	if (!auth.isAuthenticated) {
		// Guard the anon path against arbitrary strings being persisted to
		// localStorage where they would survive into future sessions. The
		// authenticated path doesn't need this because the backend
		// protovalidate pattern (^[a-z]{2}$) rejects malformed values.
		if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
			deps.logger?.warn(
				'changeLocale: refusing to persist unsupported locale',
				{ lang, supported: SUPPORTED_LANGUAGES },
			)
			return
		}
		await i18n.setLocale(lang)
		localStorage.setItem(StorageKeys.language, lang)
		return
	}

	// Authenticated: persist server-side first; only apply locally on success.
	// updatePreferredLanguage write-through updates UserService.current so
	// callers can re-read the canonical value immediately after.
	await userService.updatePreferredLanguage(lang)
	// i18n.setLocale runs as best-effort once the DB write has committed.
	// Surfacing its failure here would let the settings UI show a "couldn't
	// save" Snack even though the backend already holds the new value — a
	// phantom error from the user's perspective. Swallow it; the next
	// hydration reads the DB value and brings i18n back in sync.
	try {
		await i18n.setLocale(lang)
	} catch (err) {
		deps.logger?.warn(
			'changeLocale: i18n.setLocale failed after successful RPC',
			{ lang, err },
		)
	}
}
