import { I18N } from '@aurelia/i18n'
import { AppTask, IContainer, ILogger } from 'aurelia'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { SessionKeys, StorageKeys } from '../constants/storage-keys'
import { isSupportedLanguage, SUPPORTED_LANGUAGES } from '../util/change-locale'
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
	// Normalize via isSupportedLanguage so out-of-range navigator codes
	// (e.g. 'ja-JP', 'fr') don't round-trip into Create / UpdatePreferredLanguage
	// where the backend protovalidate constraint would reject them. Falling
	// back to 'ja' (the i18next fallbackLng) ensures the outbound RPC always
	// carries a value the backend can persist.
	const detectedLocale = i18n.getLocale()
	const clientLocale = isSupportedLanguage(detectedLocale)
		? detectedLocale
		: 'ja'

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
		applyPreferredLanguageToI18n({
			i18n,
			logger,
			clientLocale,
			preferred: current.preferredLanguage,
		})
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
				logger.info('Backfilled preferred_language', { lang: clientLocale })
			},
			(err: unknown) => {
				logger.warn(
					'Failed to backfill preferred_language; will retry on next session',
					{ error: err, lang: clientLocale },
				)
				sessionStorage.removeItem(SessionKeys.languageBackfillAttempted)
			},
		)
	}

	// removeItem is a safe no-op when the key is absent and only throws when
	// localStorage has been monkey-patched, which we don't defend against.
	localStorage.removeItem(StorageKeys.language)
}

function applyPreferredLanguageToI18n(deps: {
	i18n: I18N
	logger: { warn(message: string, ...detail: unknown[]): void }
	clientLocale: string
	preferred: string
}): void {
	const { i18n, logger, clientLocale, preferred } = deps
	// Skip the no-op steady state — every i18n.setLocale call dispatches
	// `languageChanged` and re-evaluates every `t=` binding, which is wasted
	// work when the value matches what we already have.
	if (preferred === clientLocale) return

	// Guard against unexpected DB values (a future migration or loosened
	// backend validation could persist an unsupported code). i18n.setLocale
	// would silently fall back to fallbackLng with no bundle, leaving the UI
	// blank — fail-loud-then-skip is friendlier to debugging.
	if (!isSupportedLanguage(preferred)) {
		logger.warn(
			'Ignoring unsupported preferred_language from backend; leaving i18n locale unchanged',
			{ lang: preferred, supported: SUPPORTED_LANGUAGES },
		)
		return
	}

	// Fire async without awaiting — i18next.changeLanguage is synchronous
	// from a network standpoint here (bundles are statically imported), so
	// the returned promise resolves on the next microtask and is not load-
	// bearing for first render. Failures land in the catch.
	void i18n.setLocale(preferred).catch((err: unknown) => {
		logger.warn('Failed to apply preferred language to i18n', {
			error: err,
			lang: preferred,
		})
	})
}

export const UserHydrationTask = AppTask.activating(
	IContainer,
	runUserHydration,
)
