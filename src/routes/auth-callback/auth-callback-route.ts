import { I18N } from '@aurelia/i18n'
import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { codeToHome } from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
import { IAuthService } from '../../services/auth-service'
import { IGuestDataMergeService } from '../../services/guest-data-merge-service'
import { IGuestService } from '../../services/guest-service'
import { IUserService } from '../../services/user-service'
import {
	isSupportedLanguage,
	normalizeToSupportedLanguage,
} from '../../util/change-locale'

/**
 * OIDC callback handler that processes the authorization code exchange
 * and redirects to the appropriate destination.
 *
 * Uses canLoad() to return a NavigationInstruction, which the Aurelia Router
 * handles internally within the transition pipeline. This avoids calling
 * router.load() from attached(), which can hang because attached() fires
 * during the _swap phase when _isNavigating is still true.
 */
export class AuthCallbackRoute {
	public error = ''

	private readonly authService = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly mergeService = resolve(IGuestDataMergeService)
	private readonly guest = resolve(IGuestService)
	private readonly i18n = resolve(I18N)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallbackRoute')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			const isNewUser = await this.ensureUserProvisioned(user.profile.email)

			// Apply the DB-stored preferred language to i18n for the
			// current session. UserHydrationTask normally owns this, but
			// it's an AppTask.activating that fires once at app boot —
			// the pre-auth tick already ran and returned early. Without
			// this manual apply, a mid-session sign-in leaves the app
			// rendering in the anonymous-period locale until a hard
			// reload triggers the next activating cycle.
			//
			// Guard with isSupportedLanguage to mirror the hydration
			// task's defense against unexpected DB values (manual edit,
			// loosened backend validation, schema drift) — i18n.setLocale
			// would silently fall back to fallbackLng with no bundle,
			// leaving the UI blank.
			const preferred = this.userService.current?.preferredLanguage
			// Normalize getLocale() before comparing — i18next's detector
			// returns a BCP 47 region tag ('en-US') when navigator.language
			// is region-tagged AND no prior setLocale call has cached a
			// 2-letter code. Without normalize, 'en' !== 'en-US' is always
			// true and setLocale fires on every sign-in for English-browser
			// users, triggering the i18next-browser-languagedetector
			// `languageChanged` listener to write localStorage['language']
			// — contradicting the PR's invariant of no implicit localStorage
			// writes during the authed path.
			if (
				preferred &&
				isSupportedLanguage(preferred) &&
				preferred !== normalizeToSupportedLanguage(this.i18n.getLocale())
			) {
				try {
					await this.i18n.setLocale(preferred)
				} catch (err) {
					this.logger.warn(
						'Failed to apply DB-preferred language to i18n after sign-in',
						{ error: err, lang: preferred },
					)
				}
			} else if (preferred && !isSupportedLanguage(preferred)) {
				this.logger.warn(
					'Ignoring unsupported preferred_language from backend after sign-in',
					{ lang: preferred },
				)
			}

			// Merge any guest data accumulated during onboarding
			await this.mergeService.merge()

			// On first-time signup: set flag so dashboard shows PostSignupDialog
			if (isNewUser) {
				localStorage.setItem(StorageKeys.postSignupShown, 'pending')
			}

			return '/dashboard'
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				return '/dashboard'
			}

			// Let the component render with the error message
			this.error = `Login failed: ${err instanceof Error ? err.message : String(err)}`
			return true
		}
	}

	// Resolve the caller's internal user_id and cache it.
	//
	// When the guest selected a home during onboarding, we MUST take the
	// explicit-Create path so the home is persisted atomically with the user
	// record (idempotent Create on the backend ignores `home` for existing
	// users, so this is also safe for sign-in-as-existing).
	//
	// Otherwise UserService.ensureLoaded() handles everything: cache hit →
	// Get, cache miss → idempotent Create using the JWT email.
	//
	// Returns true when this session looks like a first-time signup. The
	// presence of guestHome (set only during the onboarding flow before
	// account creation) is a reliable proxy.
	private async ensureUserProvisioned(
		email: string | undefined,
	): Promise<boolean> {
		const guestHome = this.guest.home
		if (guestHome && email) {
			// Capture the effective locale at signup so the new user row carries
			// the language the visitor was experiencing pre-account.
			//
			// localStorage['language'] cleanup is owned by UserHydrationTask
			// (single owner for the legacy-key migration). The task is
			// registered as an AppTask.activating which is a ONE-TIME boot
			// hook: it fires once when Aurelia transitions to active state,
			// before any routing — it does NOT re-run on subsequent
			// navigations.
			//
			// Concretely:
			//   - For both sign-in and sign-up flows arriving here via the
			//     OIDC callback, AppTask.activating already fired earlier in
			//     the same browser session, while the user was still
			//     unauthenticated. runUserHydration returned early in that
			//     pre-auth tick (auth.ready resolved with isAuthenticated =
			//     false), so cleanup did NOT run on the current session.
			//   - The cleanup therefore runs on the NEXT cold-boot tick
			//     once the user is authenticated. The legacy key may
			//     survive the current session, which is harmless because
			//     no authenticated code path reads it.
			//
			// If "cleanup before first authenticated read" ever becomes a
			// hard requirement, the right fix is to call the cleanup
			// imperatively here, not to rely on AppTask.activating.
			await this.userService.create(
				email,
				normalizeToSupportedLanguage(this.i18n.getLocale()),
				codeToHome(guestHome),
			)
			return true
		}

		await this.userService.ensureLoaded(
			normalizeToSupportedLanguage(this.i18n.getLocale()),
		)
		return false
	}
}
