import type { I18N } from '@aurelia/i18n'
import type { ILocalStorage } from '../adapter/storage/local-storage'
import { StorageKeys } from '../constants/storage-keys'
import type { IAuthService } from '../services/auth-service'
import type { IUserService } from '../services/user-service'

export const SUPPORTED_LANGUAGES = ['ja', 'en'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * Type guard for the UI's locale allowlist. Shared between the changeLocale
 * utility and the hydration task so both validate the same way against the
 * single source of truth.
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
	return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang)
}

export interface ChangeLocaleLogger {
	warn(message: string, ...detail: unknown[]): void
}

export interface ChangeLocaleDeps {
	readonly i18n: I18N
	readonly auth: IAuthService
	readonly userService: IUserService
	readonly localStorage: ILocalStorage
	/**
	 * Routes the post-RPC `i18n.setLocale`-failure warning through the
	 * project's structured log sink (otel-log-sink) instead of bare
	 * `console.warn`. Optional so unit tests can omit it; production
	 * callers should always pass their scoped `ILogger`.
	 */
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
 *   apply `i18n.setLocale` after success. This function performs no
 *   explicit localStorage writes in the authed branch — the backend row is
 *   the source of truth and the hydration task clears the legacy key on
 *   next boot.
 *
 *   Caveat: `i18next-browser-languagedetector` is configured with
 *   `caches: ['localStorage']` in `main.ts` so anonymous-period detection
 *   persists. Its `languageChanged` listener side-effects an implicit
 *   `localStorage['language']` write on every `i18n.setLocale` call —
 *   including the authed branch below. The write is harmless because
 *   (a) no authenticated code path reads the key, and (b) the next
 *   hydration removes it. The invariant we promise is therefore "no
 *   *explicit* localStorage writes from this function in the authed
 *   branch", not "localStorage is never touched between boots".
 *
 * Throws `TypeError` when `lang` is not in `SUPPORTED_LANGUAGES` so a
 * mis-wired UI control surfaces the bug instead of silently doing nothing.
 * Rethrows on both RPC failure AND i18n.setLocale failure so the caller
 * can surface a user-visible error (Snack). Note: a setLocale failure
 * after a successful RPC means the DB already holds the new value while
 * the UI still renders the old locale — the Snack reads as "couldn't
 * save" which slightly under-states reality, but is preferable to a
 * silent visual inconsistency (selector highlights the new value while
 * every `t=` binding renders the old). Hydration re-syncs i18n on the
 * next boot.
 */
export async function changeLocale(
	deps: ChangeLocaleDeps,
	lang: string,
): Promise<void> {
	const { i18n, auth, userService, localStorage } = deps

	// Guard both paths against arbitrary strings. The anon path would
	// otherwise persist them to localStorage where they survive into future
	// sessions; the authed path would round-trip an unsupported code through
	// the RPC into the DB. Throwing keeps the contract loud — silently
	// returning would let callers think the change succeeded.
	if (!isSupportedLanguage(lang)) {
		throw new TypeError(
			`changeLocale: unsupported locale "${lang}" (supported: ${SUPPORTED_LANGUAGES.join(', ')})`,
		)
	}

	if (!auth.isAuthenticated) {
		await i18n.setLocale(lang)
		localStorage.setItem(StorageKeys.language, lang)
		return
	}

	await userService.updatePreferredLanguage(lang)
	// Surface i18n.setLocale failures even though the DB write already
	// committed. Swallowing them would leave the settings selector
	// highlighting the new language (sourced from the write-through
	// userService.current) while every `t=` binding still renders in the
	// old locale — visually inconsistent with no error indication. The
	// trade-off is that the resulting Snack reads as "couldn't save",
	// which slightly under-states reality (the value IS saved
	// server-side); the next hydration will re-sync i18n on its own.
	await i18n.setLocale(lang)
}
