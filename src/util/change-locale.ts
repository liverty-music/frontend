import type { I18N } from '@aurelia/i18n'
import type { ILocalStorage } from '../adapter/storage/local-storage'
import { StorageKeys } from '../constants/storage-keys'
import type { IAuthService } from '../services/auth-service'
import type { IUserStore } from '../services/user-store'

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
 * the `preferred_language` proto rule accepts (ISO 639-1 two-letter,
 * lowercase). This is coercion, not validation: the rule itself is enforced
 * client-side by the transport's validation interceptor
 * (`services/validate-interceptor.ts`) and authoritatively by the backend.
 * Handles three input shapes:
 *
 *   - already in `SUPPORTED_LANGUAGES` (`'ja'`, `'en'`) → returned as-is.
 *   - BCP 47 region tag (`'en-US'`, `'ja-JP'`, `'zh-Hant-TW'`) → strip the
 *     subtags and lowercase. `'en-US'` becomes `'en'` and is then checked.
 *   - everything else (`'fr'`, `'zh'`, `''`) → `'en'`, the fallbackLng from
 *     main.ts and the hosted login's default language, so a browser in an
 *     unsupported language sees one language end to end.
 *
 * The result is also what `UserService.Create` and the backfill receive, so
 * an account created from such a browser gets `'en'`.
 */
export function normalizeToSupportedLanguage(detected: string): string {
	if (isSupportedLanguage(detected)) return detected
	const base = detected.split('-')[0]?.toLowerCase() ?? ''
	if (isSupportedLanguage(base)) return base
	return 'en'
}

/**
 * The language the app is showing, as one of `SUPPORTED_LANGUAGES`. This is
 * what the page declares (`<html lang>`) and what a sign-in or sign-up asks
 * the hosted login to show (OIDC `ui_locales`).
 */
export function currentLanguage(i18n: Pick<I18N, 'getLocale'>): string {
	return normalizeToSupportedLanguage(i18n.getLocale())
}

export interface ChangeLocaleDeps {
	readonly i18n: I18N
	readonly auth: IAuthService
	readonly userStore: IUserStore
	/** Where the applied language is saved on this device. */
	readonly storage: Pick<ILocalStorage, 'setItem'>
}

/**
 * Shared entry point for changing the active locale.
 *
 * Routes persistence based on the caller's auth state:
 *
 * - **Unauthenticated** (Welcome / guest Settings): call `i18n.setLocale` then
 *   persist the choice explicitly to the single `language` key through
 *   `deps.storage` (the i18next detector cache). `UserStore.currentLanguage` derives the guest
 *   highlight from the reactive `i18nLocale` mirror that `setLocale` updates, so
 *   the selector follows the active locale with no separate guest key. The
 *   explicit write makes persistence ordering-independent rather than relying on
 *   the detector's implicit cache side-effect. No backend call.
 *
 * - **Authenticated** (Settings page): call `UserStore.updatePreferredLanguage`
 *   first, apply `i18n.setLocale` after success, then save it to the same
 *   `language` key. The backend row is the source of truth while signed in;
 *   the key carries the language across sign-out, so the Welcome page after
 *   it opens in the language shown before. When the RPC fails, neither the
 *   locale nor the key changes.
 *
 * Throws `TypeError` for unsupported `lang`. Other errors propagate so
 * the caller can surface them.
 */
export async function changeLocale(
	deps: ChangeLocaleDeps,
	lang: string,
): Promise<void> {
	const { i18n, auth, userStore, storage } = deps

	if (!isSupportedLanguage(lang)) {
		throw new TypeError(
			`changeLocale: unsupported locale "${lang}" (supported: ${SUPPORTED_LANGUAGES.join(', ')})`,
		)
	}

	if (!auth.isAuthenticated) {
		await i18n.setLocale(lang)
		storage.setItem(StorageKeys.language, lang)
		return
	}

	await userStore.updatePreferredLanguage(lang)
	await i18n.setLocale(lang)
	storage.setItem(StorageKeys.language, lang)
}
