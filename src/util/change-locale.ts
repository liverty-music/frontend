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
 * Thrown by changeLocale when the backend `UpdatePreferredLanguage` RPC
 * succeeded but the subsequent `i18n.setLocale` rejected. The DB
 * already holds the new value; only the local UI failed to switch.
 * Callers can `instanceof SetLocaleError` to distinguish this from
 * a TRUE save failure (network error → `ConnectError`) or a
 * programmer error (`TypeError` etc.) and surface a Snack instead of
 * propagating to the global error boundary.
 */
export class SetLocaleError extends Error {
	public readonly lang: string
	public readonly cause: unknown

	constructor(lang: string, cause: unknown) {
		super(
			`changeLocale: i18n.setLocale failed after successful RPC (lang=${lang})`,
		)
		this.name = 'SetLocaleError'
		this.lang = lang
		this.cause = cause
	}
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
	// committed. Wrap in SetLocaleError so the caller can distinguish
	// "RPC succeeded, only UI switch failed" from a programmer error or
	// a network failure. Settings catches it and shows a Snack instead
	// of letting it propagate to the global error boundary.
	try {
		await i18n.setLocale(lang)
	} catch (err) {
		throw new SetLocaleError(lang, err)
	}
}
