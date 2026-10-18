import { I18N } from '@aurelia/i18n'
import type { NavigationInstruction, Params, RouteNode } from '@aurelia/router'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import { codeToHome } from '../../constants/iso3166'
import { StorageKeys } from '../../constants/storage-keys'
import {
	IAuthService,
	resolveAuthFlow,
	resolveAuthOrigin,
	resolveAuthReturnTo,
} from '../../services/auth-service'
import { GuestMigrationRequested } from '../../services/events/guest-migration-requested'
import { IOnboardingService } from '../../services/onboarding-service'
import { IUserStore, type ProvisionResult } from '../../services/user-store'
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
	/**
	 * Completing sign-in failed and the fan has no session. The page shows
	 * fixed catalog copy; the error itself goes only to the console log.
	 */
	public failed = false

	private readonly authService = resolve(IAuthService)
	private readonly userStore = resolve(IUserStore)
	private readonly onboarding = resolve(IOnboardingService)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)
	private readonly storage = resolve(ILocalStorage)
	private readonly logger = resolve(ILogger).scopeTo('AuthCallbackRoute')

	public async canLoad(
		_params: Params,
		_next: RouteNode,
	): Promise<boolean | NavigationInstruction> {
		this.logger.info('Processing OIDC callback...')
		try {
			const user = await this.authService.handleCallback()
			this.logger.info('handleCallback success!')

			const { user: provisioned, created } = await this.ensureUserProvisioned(
				user.profile.email,
			)

			// Request guest-follow migration on EVERY successful authenticated
			// callback (sign-up AND returning sign-in), not only on sign-up. A
			// returning user who browsed anonymously (accumulating guest follows)
			// and then signs in via Settings / auth-status — paths that do NOT
			// clearAll — would otherwise lose those follows in-session until a
			// cold-boot reconcile healed them. FollowStore.migrateGuestFollows is
			// receipt-guarded, idempotent, and a no-op on an empty queue, so firing
			// unconditionally is safe (empty queue → nothing; already-migrated →
			// not re-migrated).
			//
			// migrateGuestFollows keys its receipt on the User's id;
			// ensureUserProvisioned guarantees `userStore.current` is hydrated
			// before we read it.
			const userId = provisioned?.id ?? this.userStore.current?.id
			if (userId) {
				this.ea.publish(new GuestMigrationRequested(userId))
			} else {
				this.logger.warn(
					'Authenticated callback but no user id available; skipping follow migration trigger',
				)
			}

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
			const preferred = this.userStore.current?.preferredLanguage
			// Normalize getLocale() before comparing — i18next's detector
			// returns a BCP 47 region tag ('en-US') when navigator.language
			// is region-tagged AND no prior setLocale call has cached a
			// 2-letter code. Without normalize, 'en' !== 'en-US' is always
			// true and setLocale fires on every sign-in for English-browser
			// users.
			//
			// The applied language is saved on this device as well, so the
			// first screen after a sign-out opens in it.
			if (
				preferred &&
				isSupportedLanguage(preferred) &&
				preferred !== normalizeToSupportedLanguage(this.i18n.getLocale())
			) {
				try {
					await this.i18n.setLocale(preferred)
					this.storage.setItem(StorageKeys.language, preferred)
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

			// Complete the sign-up onboarding hand-off. The follow + hype
			// migration is owned SOLELY by FollowStore (triggered by the
			// GuestMigrationRequested event published above), so this hand-off is
			// reduced to its non-follow orchestration:
			//   - clear the home/language/help-seen guest preferences (UserStore's
			//     slice); the follow queue is intentionally RETAINED so the
			//     in-flight GuestMigrationRequested drain is not stranded.
			//   - mark onboarding complete.
			// Both are idempotent and safe on the returning-sign-in path.
			this.userStore.clearGuest()
			this.onboarding.finish()

			// Set the flag so the dashboard shows the PostSignupDialog only on a
			// genuine first sign-up. Gate on the OIDC sign-up FLOW marker (which
			// button the user actually pressed — round-tripped through OIDC state)
			// AND-narrowed by `created` (the server had no User for this identity
			// before this callback). A sign-in carries no marker, so it never
			// celebrates, whatever the local storage holds. A missing marker
			// (older in-flight redirect, direct callback hit) fails closed to "not
			// sign-up" per design D3. The `created` AND-condition suppresses the
			// "returning user taps Sign up" case.
			//
			// A sign-up started on an Event page skips both surfaces: the fan
			// returns to the event to buy, and the purchase flow owns the
			// notification / install prompts that follow it.
			const isSignUpFlow = resolveAuthFlow(user) === 'signup'
			const fromEventPage = resolveAuthOrigin(user) === 'event-page'
			if (isSignUpFlow && created && !fromEventPage) {
				this.storage.setItem(StorageKeys.postSignupShown, 'pending')
			}

			// After an involuntary re-auth, return to where the user was;
			// otherwise to where the sign-up started (carried in the OIDC state).
			// takeReturnTo() runs first so its single-shot entry is always consumed.
			return (
				this.authService.takeReturnTo() ??
				resolveAuthReturnTo(user) ??
				'/dashboard'
			)
		} catch (err) {
			this.logger.error('Auth callback error:', err)

			if (this.authService.isAuthenticated) {
				this.logger.warn(
					'User is already authenticated. Redirecting despite callback error...',
				)
				return this.authService.takeReturnTo() ?? '/dashboard'
			}

			// Hard failure: discard any stored return-to so it can't be replayed by
			// a later, unrelated successful sign-in.
			this.authService.takeReturnTo()
			// Let the component render the fixed failure copy.
			this.failed = true
			return true
		}
	}

	// Resolve (or provision) the caller's User.
	//
	// When the guest selected a home during onboarding, we MUST take the
	// explicit-Create path so the home is persisted atomically with the user
	// record (idempotent Create on the backend ignores `home` for existing
	// users, so this is also safe for sign-in-as-existing).
	//
	// Otherwise UserStore.ensureLoaded() handles everything: Get, then the
	// idempotent Create using the JWT email when Get answers NotFound.
	//
	// Returns the provisioned/loaded user (so the caller has the User's id for
	// the migration trigger) plus `created`, which the caller uses only to
	// AND-narrow the post-signup dialog gate. The primary gate is the OIDC
	// sign-up FLOW marker (see canLoad).
	private async ensureUserProvisioned(
		email: string | undefined,
	): Promise<ProvisionResult> {
		const guestHome = this.userStore.guestHome
		if (guestHome && email) {
			// Capture the effective locale at signup so the new user row carries
			// the language the visitor was experiencing pre-account.
			return this.userStore.create(
				email,
				normalizeToSupportedLanguage(this.i18n.getLocale()),
				codeToHome(guestHome),
			)
		}

		return this.userStore.ensureLoaded(
			normalizeToSupportedLanguage(this.i18n.getLocale()),
		)
	}
}
