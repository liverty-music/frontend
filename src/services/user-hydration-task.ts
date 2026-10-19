import { I18N } from '@aurelia/i18n'
import { AppTask, DI, IContainer, ILogger } from 'aurelia'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { SessionKeys, StorageKeys } from '../constants/storage-keys'
import { IAnalyticsService } from '../lib/analytics/analytics-service'
import {
	isSupportedLanguage,
	normalizeToSupportedLanguage,
	SUPPORTED_LANGUAGES,
} from '../util/change-locale'
import { IAuthService } from './auth-service'
import { IUserStore } from './user-store'

/**
 * Runs the authenticated boot sequence:
 *   1. Wait for auth readiness.
 *   2. Hydrate `UserStore.current` via `ensureLoaded` (Get or idempotent Create).
 *   3. Apply `current.preferredLanguage` to i18n, or backfill it from the
 *      currently effective locale when the row has no preference yet.
 *
 * `localStorage['language']` is kept: the detector writes the applied locale
 * back to it, so after a sign-out (or an involuntary logout) the next boot
 * opens in the account's language instead of re-detecting from `navigator`.
 *
 * Exported separately from the `AppTask` wrapper so unit tests can drive the
 * full hydration flow with stubbed services.
 */
export async function runUserHydration(container: IContainer): Promise<void> {
	const auth = container.get(IAuthService)
	await auth.ready

	if (!auth.isAuthenticated) return

	const userStore = container.get(IUserStore)
	const logger = container.get(ILogger).scopeTo('UserHydrationTask')
	const i18n = container.get(I18N)
	const localStorage = container.get(ILocalStorage)

	// Capture once: setLocale isn't called between here and the backfill
	// branch, so reusing the value also guarantees that ensureLoaded's
	// Create-when-no-User path and the backfill RPC send identical strings.
	//
	// Normalize so out-of-range navigator codes don't round-trip into
	// Create / UpdatePreferredLanguage, where the `preferred_language` proto
	// rule (checked by the transport's validation interceptor, then by the
	// backend) would reject them. normalizeToSupportedLanguage handles
	// BCP 47 region tags too ('en-US' → 'en') so English-browser users
	// get accounts created with 'en' rather than the fallbackLng 'ja'.
	const clientLocale = normalizeToSupportedLanguage(i18n.getLocale())

	try {
		await userStore.ensureLoaded(clientLocale)
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
	const current = userStore.current
	if (!current) return

	// Identify the just-loaded user to AnalyticsService. Under the opt-out
	// model analytics is on by default, so this normally calls
	// `posthog.identify(user.id, …)` immediately — with NO preceding
	// reset() — so the anonymous pre-identification discovery history merges
	// into the identified profile. The service short-circuits internally
	// only when the user has explicitly opted out of analytics.
	container.get(IAnalyticsService).identify(current.id)

	if (current.preferredLanguage) {
		// AWAIT setLocale before runUserHydration resolves: the wrapping
		// AppTask.activating delays first render until this promise
		// settles, so finishing locale-apply here means the first paint
		// renders in the DB-authoritative locale rather than the
		// client-detected one. Without the await Aurelia marks the app
		// active and routes immediately, producing a visible
		// language flash when setLocale eventually fires.
		//
		// Save the applied locale explicitly rather than relying on the
		// detector's cache side effect, so the first screen after a sign-out
		// opens in it. On apply failure the saved language stays as it was.
		const applied = await applyPreferredLanguageToI18n({
			i18n,
			logger,
			clientLocale,
			preferred: current.preferredLanguage,
		})
		if (applied) {
			localStorage.setItem(StorageKeys.language, current.preferredLanguage)
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
		void userStore.updatePreferredLanguage(clientLocale).then(
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
}

/**
 * Apply `preferred` to i18n if it differs from the current locale and is
 * supported. Returns `true` when the account's language is now in effect
 * (switched, or already correct), `false` when it refused an unsupported
 * value or setLocale rejected; both are logged and leave the locale
 * unchanged. Never throws.
 */
async function applyPreferredLanguageToI18n(deps: {
	i18n: I18N
	logger: { warn(message: string, ...detail: unknown[]): void }
	clientLocale: string
	preferred: string
}): Promise<boolean> {
	const { i18n, logger, clientLocale, preferred } = deps
	// Already correct — no setLocale needed.
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

/**
 * Settles once the boot-time user hydration has finished (or failed, or there
 * is no signed-in user). Code that reads `UserStore.current` at start-up or
 * on a route load waits for it, because the first render does not always.
 */
export const IUserHydration = DI.createInterface<IUserHydration>(
	'IUserHydration',
	(x) => x.singleton(UserHydration),
)
export interface IUserHydration extends UserHydration {}
export class UserHydration {
	public ready: Promise<void> = Promise.resolve()
}

/** Whether the document was opened on the Discovery route. */
export function opensOnDiscovery(pathname: string): boolean {
	return pathname === '/discovery' || pathname.startsWith('/discovery/')
}

/**
 * Hydrates the user at boot and returns what the first render waits for:
 * the hydration, except when the app opens on Discovery. Discovery reads
 * nothing of the user, and waiting held its first bubbles back by a
 * `UserService.Get` round trip. Routes that do read the user wait for
 * `IUserHydration.ready` in the auth hook.
 */
export function startUserHydration(
	container: IContainer,
	pathname: string,
): Promise<void> | undefined {
	const run = runUserHydration(container)
	container.get(IUserHydration).ready = run.then(
		() => undefined,
		() => undefined,
	)
	if (!opensOnDiscovery(pathname)) return run
	run.catch((err: unknown) => {
		container
			.get(ILogger)
			.scopeTo('UserHydrationTask')
			.warn('User hydration failed', { error: err })
	})
	return undefined
}

export const UserHydrationTask = AppTask.activating(
	IContainer,
	(container: IContainer) =>
		startUserHydration(container, window.location.pathname),
)
