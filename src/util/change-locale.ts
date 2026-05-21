import type { I18N } from '@aurelia/i18n'
import type { IAuthService } from '../services/auth-service'
import type { IUserService } from '../services/user-service'

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const

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
		await i18n.setLocale(lang)
		localStorage.setItem('language', lang)
		return
	}

	// Authenticated: persist server-side first; only apply locally on success.
	// updatePreferredLanguage write-through updates UserService.current so
	// callers can re-read the canonical value immediately after.
	await userService.updatePreferredLanguage(lang)
	await i18n.setLocale(lang)
}
