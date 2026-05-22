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
 *   apply `i18n.setLocale` only on success, and NEVER touch
 *   `localStorage['language']`. The DB is the source of truth post-signup,
 *   and the hydration task is responsible for clearing the legacy key.
 *
 * Throws `TypeError` when `lang` is not in `SUPPORTED_LANGUAGES` so a
 * mis-wired UI control surfaces the bug instead of silently doing nothing.
 * On RPC failure, the function rethrows so the caller can surface a
 * user-visible error (Snack) and keep the prior locale active.
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
	// Once the DB write has committed, i18n.setLocale is best-effort.
	// Propagating its failure would surface a phantom "couldn't save" Snack
	// to the settings UI even though the backend already holds the new value;
	// the next hydration reads the DB and re-syncs i18n.
	try {
		await i18n.setLocale(lang)
	} catch (err) {
		deps.logger?.warn(
			'changeLocale: i18n.setLocale failed after successful RPC',
			{ lang, err },
		)
	}
}
