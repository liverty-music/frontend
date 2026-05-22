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

/**
 * Coerce an arbitrary detector-emitted locale string to one of the values
 * the backend protovalidate constraint accepts (ISO 639-1 two-letter,
 * lowercase). Handles three input shapes:
 *
 *   - already in `SUPPORTED_LANGUAGES` (`'ja'`, `'en'`) → returned as-is.
 *   - BCP 47 region tag (`'en-US'`, `'ja-JP'`, `'zh-Hant-TW'`) → strip the
 *     subtags and lowercase. `'en-US'` becomes `'en'` and is then checked.
 *   - everything else (`'fr'`, `'zh'`, `''`) → fall through to the
 *     fallbackLng from main.ts (`'ja'`).
 *
 * Without the region-tag stripping, English-browser users (whose
 * navigator typically returns `'en-US'`) would have accounts created
 * and backfilled with `'ja'`, contradicting their browser preference.
 */
export function normalizeToSupportedLanguage(detected: string): string {
	if (isSupportedLanguage(detected)) return detected
	const base = detected.split('-')[0]?.toLowerCase() ?? ''
	if (isSupportedLanguage(base)) return base
	return 'ja'
}

export interface ChangeLocaleDeps {
	readonly i18n: I18N
	readonly auth: IAuthService
	readonly userService: IUserService
	readonly localStorage: ILocalStorage
}

/**
 * Shared entry point for changing the active locale.
 *
 * Routes persistence based on the caller's auth state:
 *
 * - **Unauthenticated** (Welcome page): write through to
 *   `localStorage['language']` after `i18n.setLocale`. No backend call.
 *
 * - **Authenticated** (Settings page): call `UpdatePreferredLanguage` first,
 *   apply `i18n.setLocale` after success. The backend row is the source
 *   of truth; the hydration task clears the legacy localStorage key on
 *   next boot.
 *
 * Throws `TypeError` for unsupported `lang`. Other errors propagate so
 * the caller can surface them.
 */
export async function changeLocale(
	deps: ChangeLocaleDeps,
	lang: string,
): Promise<void> {
	const { i18n, auth, userService, localStorage } = deps

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
	await i18n.setLocale(lang)
}
