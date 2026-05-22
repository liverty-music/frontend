import { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import { Snack } from '../../components/snack-bar/snack'
import { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { IAppConfig } from '../../config/app-config'
import { translationKey } from '../../constants/iso3166'
import { IAuthService } from '../../services/auth-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'
import { IUserService } from '../../services/user-service'
import { changeLocale, SUPPORTED_LANGUAGES } from '../../util/change-locale'

// ConnectError codes considered transient (worth showing a Snack and inviting
// the user to retry). Any other ConnectError is a contract / business-rule
// failure where retry won't help; we surface those via the logger and rethrow
// so the global error handler can route them.
const TRANSIENT_CONNECT_CODES: readonly Code[] = [
	Code.Unavailable,
	Code.DeadlineExceeded,
	Code.ResourceExhausted,
]

export class SettingsRoute {
	public readonly auth = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly localStorage = resolve(ILocalStorage)

	public currentHome: string | null = null
	public currentLocale = ''
	public notificationsEnabled = false
	public vapidAvailable = !!resolve(IAppConfig).vapidPublicKey
	public homeSelector!: UserHomeSelector
	public languageSelectorOpen = false
	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	private isToggling = false

	public emailVerified = false
	public isResendingVerification = false
	public resendSuccess = false

	public get currentHomeKey(): string {
		return this.currentHome
			? `userHome.prefectures.${this.currentHome}`
			: 'settings.notSet'
	}

	public async loading(): Promise<void> {
		// Source-of-truth for authenticated language is the backend user row.
		// Fall back to the active i18n locale only when hydration has not yet
		// populated `current.preferredLanguage` (e.g., very first render after
		// signup). MUST NOT read localStorage['language'] here.
		this.currentLocale =
			this.userService.current?.preferredLanguage ?? this.i18n.getLocale()
		const homeLevel1 = this.userService.current?.home?.level1
		const code = homeLevel1 ?? UserHomeSelector.getStoredHome()
		this.currentHome = code ? translationKey(code) : null

		// Read email_verified from OIDC profile claims
		this.emailVerified =
			(this.auth.user?.profile as Record<string, unknown>)?.email_verified ===
			true

		await this.resolveNotificationToggleState()
	}

	/**
	 * Derives the push notifications toggle state from (1) the browser's
	 * `PushManager` subscription and (2) the backend's `push_subscriptions`
	 * row. When the browser has a subscription but the backend does not —
	 * e.g., a prior Create RPC failed silently or another device unsubscribed
	 * globally in an older build — this method self-heals by re-registering
	 * the existing browser subscription via the `Create` RPC.
	 */
	private async resolveNotificationToggleState(): Promise<void> {
		if (this.notificationManager.permission !== 'granted') {
			this.notificationsEnabled = false
			return
		}

		const browserSub = await this.pushService.getBrowserSubscription()
		if (!browserSub) {
			this.notificationsEnabled = false
			return
		}

		const userId = this.userService.current?.id ?? ''
		if (!userId) {
			this.logger.warn(
				'Cannot resolve push toggle state without authenticated userId',
			)
			this.notificationsEnabled = false
			return
		}

		try {
			const exists = await this.pushService.existsOnBackend(
				userId,
				browserSub.endpoint,
			)
			if (exists) {
				this.notificationsEnabled = true
				return
			}
			// Self-heal: browser has subscription but backend is missing the row.
			// Re-register using the existing material — no permission prompt needed.
			this.logger.info(
				'Push subscription exists on browser but not on backend; self-healing via Create',
			)
			await this.pushService.createFrom(browserSub)
			this.notificationsEnabled = true
		} catch (err) {
			this.logger.error('Failed to resolve push notification toggle state', err)
			this.notificationsEnabled = false
		}
	}

	public openHomeSelector(): void {
		this.homeSelector.open()
	}

	public onHomeSelected(code: string): void {
		this.currentHome = translationKey(code)
		this.logger.info('Home area updated from settings', { code })
	}

	public openLanguageSelector(): void {
		this.languageSelectorOpen = true
	}

	public async selectLanguage(lang: string): Promise<void> {
		// Compare against currentLocale (backend-sourced) rather than
		// i18n.getLocale() so the guard matches `isCurrentLanguage`.
		const previous = this.currentLocale
		// Close the selector immediately, before any awaited work, so the
		// sheet doesn't stay frozen on slow connections (INP-friendly).
		this.languageSelectorOpen = false
		if (lang === previous) {
			// Spec: re-selecting the active language is a no-op.
			return
		}
		try {
			await changeLocale(
				{
					i18n: this.i18n,
					auth: this.auth,
					userService: this.userService,
					localStorage: this.localStorage,
					logger: this.logger,
				},
				lang,
			)
		} catch (err) {
			// Programmer errors (TypeError, missing deps) re-throw so real
			// bugs surface to the global error boundary.
			if (!(err instanceof ConnectError)) {
				this.logger.error(
					'Failed to update preferred language (non-network error; re-throwing)',
					{ error: err, from: previous, to: lang },
				)
				throw err
			}
			// Only transient ConnectError codes map to a user-facing Snack —
			// non-transient codes (INVALID_ARGUMENT, NOT_FOUND, etc.) are
			// contract bugs the user can't help with; log and rethrow so they
			// surface to the global error boundary instead of being hidden
			// behind a misleading "try again" Snack.
			if (!TRANSIENT_CONNECT_CODES.includes(err.code)) {
				this.logger.error(
					'Non-transient ConnectError in selectLanguage; re-throwing',
					{ error: err, code: err.code, from: previous, to: lang },
				)
				throw err
			}
			this.logger.error('Failed to update preferred language', {
				error: err,
				from: previous,
				to: lang,
			})
			this.ea.publish(
				new Snack(this.i18n.tr('settings.languageChangeError'), 'error'),
			)
			return
		}
		// i18n.setLocale already ran inside changeLocale, so getLocale() is
		// the authoritative post-success value (and reflects any
		// server-side normalization that updatePreferredLanguage applied).
		this.currentLocale = this.i18n.getLocale()
		this.logger.info('Language changed', {
			from: previous,
			to: this.currentLocale,
		})
	}

	public isCurrentLanguage(lang: string): boolean {
		return this.currentLocale === lang
	}

	public async toggleNotifications(): Promise<void> {
		if (this.isToggling) return
		this.isToggling = true

		try {
			const newValue = !this.notificationsEnabled
			const userId = this.userService.current?.id ?? ''
			if (!userId) {
				this.logger.warn(
					'Cannot toggle push notifications without authenticated userId',
				)
				return
			}

			if (newValue) {
				const endpoint = await this.pushService.create()
				if (!endpoint) {
					// User declined the permission prompt or VAPID key is missing.
					this.notificationsEnabled = false
					return
				}
				this.notificationsEnabled = true
			} else {
				try {
					await this.pushService.delete(userId)
				} catch (err) {
					this.logger.error('Failed to unsubscribe push notifications', err)
				}
				this.notificationsEnabled = false
			}
		} catch (err) {
			this.logger.error('Failed to toggle push notifications', err)
		} finally {
			this.isToggling = false
		}
	}

	public async resendVerification(): Promise<void> {
		if (this.isResendingVerification) return
		this.isResendingVerification = true
		this.resendSuccess = false

		try {
			await this.userService.resendEmailVerification()
			this.resendSuccess = true
		} catch (err) {
			if (err instanceof ConnectError && err.code === Code.ResourceExhausted) {
				this.ea.publish(
					new Snack(this.i18n.tr('settings.resendRateLimited'), 'error'),
				)
			} else {
				this.logger.error('Failed to resend verification email', err)
				this.ea.publish(
					new Snack(this.i18n.tr('settings.resendError'), 'error'),
				)
			}
		} finally {
			this.isResendingVerification = false
		}
	}

	public async signOut(): Promise<void> {
		try {
			this.userService.clear()
			await this.auth.signOut()
		} catch (err) {
			this.logger.error('Sign-out failed', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('settings.signOutError'), 'error'))
		}
	}
}
