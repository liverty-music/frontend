import { I18N } from '@aurelia/i18n'
import { AppTask, IContainer, ILogger } from 'aurelia'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { SessionKeys, StorageKeys } from '../constants/storage-keys'
import {
	isSupportedLanguage,
	normalizeToSupportedLanguage,
	SUPPORTED_LANGUAGES,
} from '../util/change-locale'
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
	const localStorage = container.get(ILocalStorage)

	// Capture once: setLocale isn't called between here and the backfill
	// branch, so reusing the value also guarantees that ensureLoaded's
	// Create-on-cache-miss path and the backfill RPC send identical strings.
	//
	// Normalize so out-of-range navigator codes don't round-trip into
	// Create / UpdatePreferredLanguage where the backend protovalidate
	// constraint would reject them. normalizeToSupportedLanguage handles
	// BCP 47 region tags too ('en-US' → 'en') so English-browser users
	// get accounts created with 'en' rather than the fallbackLng 'ja'.
	const clientLocale = normalizeToSupportedLanguage(i18n.getLocale())

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
		// AWAIT setLocale before runUserHydration resolves: the wrapping
		// AppTask.activating delays first render until this promise
		// settles, so finishing locale-apply here means the first paint
		// renders in the DB-authoritative locale rather than the
		// client-detected one. Without the await Aurelia marks the app
		// active and routes immediately, producing a visible
		// language flash when setLocale eventually fires.
		//
		// removeItem MUST run AFTER setLocale resolves: the
		// i18next-browser-languagedetector's `languageChanged` listener
		// (caches: ['localStorage']) writes localStorage['language'] back
		// on every setLocale call. Removing synchronously before await
		// would race the detector's microtask and the key would be
		// restored. On apply failure, KEEP localStorage — the user's
		// anonymous-period locale is the only fallback the next boot has.
		const applied = await applyPreferredLanguageToI18n({
			i18n,
			logger,
			clientLocale,
			preferred: current.preferredLanguage,
		})
		if (applied) {
			localStorage.removeItem(StorageKeys.language)
		}
	} else if (!sessionStorage.getItem(SessionKeys.languageBackfillAttempted)) {
		// Legacy NULL row: backfill once per tab. Fire-and-forget so the
		// activating-task isn't blocked on a second serial RPC before any
		// route renders — the backfill is idempotent and the current session's
		// locale (clientLocale) is already active. Set the flag optimistically
		// and clear it on failure so the next session retries.
		//
		// Intentional direct sessionStorage access: there is no
		// ISessionStorage adapter in the codebase (only ILocalStorage),
		// and the per-tab scoping of sessionStorage is exactly the
		// rate-limit granularity we want here (see the SessionKeys
		// comment in constants/storage-keys.ts). Tests in JSDOM access
		// `sessionStorage` directly in `beforeEach` to control the flag.
		sessionStorage.setItem(SessionKeys.languageBackfillAttempted, '1')
		void userService.updatePreferredLanguage(clientLocale).then(
			() => {
				localStorage.removeItem(StorageKeys.language)
				logger.info('Backfilled preferred_language', { lang: clientLocale })
			},
			(err: unknown) => {
				logger.warn(
					'Failed to backfill preferred_language; will retry on next session',
					{ error: err, lang: clientLocale },
				)
				sessionStorage.removeItem(SessionKeys.languageBackfillAttempted)
				// Intentionally keep localStorage['language'] in place so the
				// next session can re-detect the user's anonymous choice and
				// retry the backfill.
			},
		)
	}
}

/**
 * Apply `preferred` to i18n if it differs from the current locale and is
 * supported. Returns `true` when the locale was actually switched (or was
 * already correct — i.e. the DB value is now authoritatively reflected),
 * `false` when the function refused to apply (unsupported value) or
 * setLocale rejected. The caller uses this to decide whether to clean up
 * the legacy localStorage key: only do so when the DB-authoritative
 * locale is in effect, so a failed apply doesn't strand the user without
 * either the DB value (not loaded) or the localStorage fallback (just
 * erased) on the next cold boot.
 */
async function applyPreferredLanguageToI18n(deps: {
	i18n: I18N
	logger: { warn(message: string, ...detail: unknown[]): void }
	clientLocale: string
	preferred: string
}): Promise<boolean> {
	const { i18n, logger, clientLocale, preferred } = deps
	// Already correct — no setLocale needed, treat as applied so the
	// caller can proceed with cleanup.
	if (preferred === clientLocale) return true

	// Guard against unexpected DB values (a future migration or loosened
	// backend validation could persist an unsupported code). i18n.setLocale
	// would silently fall back to fallbackLng with no bundle, leaving the UI
	// blank — fail-loud-then-skip is friendlier to debugging.
	if (!isSupportedLanguage(preferred)) {
		logger.warn(
			'Ignoring unsupported preferred_language from backend; leaving i18n locale unchanged',
			{ lang: preferred, supported: SUPPORTED_LANGUAGES },
		)
		return false
	}

	// Await the setLocale promise so callers can chain post-condition work
	// (e.g. the legacy-localStorage cleanup) after the i18next-browser-
	// languagedetector's `languageChanged` listener fires — otherwise its
	// detector would restore the localStorage key we're about to remove.
	try {
		await i18n.setLocale(preferred)
		return true
	} catch (err) {
		logger.warn('Failed to apply preferred language to i18n', {
			error: err,
			lang: preferred,
		})
		return false
	}
}

export const UserHydrationTask = AppTask.activating(
	IContainer,
	runUserHydration,
)
