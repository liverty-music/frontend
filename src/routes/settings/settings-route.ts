import { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import { Snack } from '../../components/snack-bar/snack'
import type { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { IAppConfig } from '../../config/app-config'
import { translationKey } from '../../constants/iso3166'
import { IAudioEngine } from '../../services/audio-engine'
import { IAuthService } from '../../services/auth-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'
import { IUserService } from '../../services/user-service'
import {
	changeLocale,
	normalizeToSupportedLanguage,
	SUPPORTED_LANGUAGES,
} from '../../util/change-locale'

export class SettingsRoute {
	public readonly auth = resolve(IAuthService)
	private readonly userService = resolve(IUserService)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly localStorage = resolve(ILocalStorage)
	private readonly audio = resolve(IAudioEngine)

	public soundEnabled = !this.audio.muted
	public soundVolume = Math.round(this.audio.volume * 100)
	public notificationsEnabled = false
	public vapidAvailable = !!resolve(IAppConfig).vapidPublicKey
	public homeSelector!: UserHomeSelector
	public languageSelectorOpen = false
	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	private isToggling = false

	public isResendingVerification = false
	public resendSuccess = false

	// View state derived from the single source of truth: UserService.current
	// (which is @observable and re-notifies on every entity mutation). All
	// derived display values are exposed as computed getters so Aurelia's
	// proxy-based observation tracks the access chain and re-evaluates every
	// dependent binding (settings row text AND in-modal selector check) when
	// the user entity changes. No component-local mirror state, no manual
	// write-back in mutation handlers. This eliminates the desync class of
	// bug where mirror-only updates fail to propagate to method-call
	// bindings inside repeat.for (which expression observation cannot track
	// through a method body).
	public get currentLocale(): string {
		// Fallback to the active i18n locale only when hydration has not yet
		// populated `current.preferredLanguage` (e.g., very first render
		// after signup, or the hydration backfill RPC is still in flight).
		// MUST NOT read localStorage['language']. The fallback runs through
		// normalizeToSupportedLanguage so a BCP 47 tag returned by
		// i18n.getLocale() (e.g. 'en-US' when the detector falls through to
		// navigator.language) maps to 'en' — otherwise the selector compares
		// 'en-US' === 'en' and no row is highlighted.
		return (
			this.userService.current?.preferredLanguage ??
			normalizeToSupportedLanguage(this.i18n.getLocale())
		)
	}

	public get currentHome(): string | null {
		// Settings is an authenticated-only route, so the home value MUST
		// come from the user entity. The guest-flow home storage owned by
		// UserHomeSelector is consumed at signup time:
		// auth-callback's ensureUserProvisioned reads guest.home and calls
		// userService.create(email, locale, codeToHome(guestHome)), which
		// atomically persists the home into the user row via the Create
		// RPC's home field. By the time Settings ever renders, user.home
		// IS the source of truth. (GuestDataMergeService.merge() handles
		// follows/hypes only — NOT home; home is a Create-time field, not
		// a post-signup merge target.)
		//
		// If a signed-in user lacks user.home (e.g. they completed signup
		// before the home-prompt step landed, or guest.home was empty at
		// auth-callback), `currentHome` is null and the UI renders
		// 'Not set'. The user re-selects via the home-selector sheet,
		// which calls userService.updateHome — the getter then surfaces
		// the new value automatically. No localStorage fallback needed.
		const code = this.userService.current?.home?.level1
		return code ? translationKey(code) : null
	}

	public get currentHomeKey(): string {
		return this.currentHome
			? `userHome.prefectures.${this.currentHome}`
			: 'settings.notSet'
	}

	public get emailVerified(): boolean {
		// Read directly from OIDC profile claims. The `as Record<string,
		// unknown>` cast and the `email_verified` claim-name knowledge belong
		// behind AuthService (tracked under the follow-up `expose
		// claim-derived state on AuthService` refactor); keeping the inline
		// read here for now to scope this change to the user-entity SSoT
		// refactor.
		return (
			(this.auth.user?.profile as Record<string, unknown>)?.email_verified ===
			true
		)
	}

	public async loading(): Promise<void> {
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
		// UserHomeSelector already persists via userService.updateHome before
		// firing this callback, and `currentHome` is derived from
		// userService.current.home — so the view updates automatically. The
		// handler stays solely to surface a structured log line for the
		// settings-originated update path (distinct from onboarding /
		// auth-callback / hydration write paths).
		this.logger.info('Home area updated from settings', { code })
	}

	public openLanguageSelector(): void {
		this.languageSelectorOpen = true
	}

	public async selectLanguage(lang: string): Promise<void> {
		const previous = this.currentLocale
		this.languageSelectorOpen = false
		if (lang === previous) return
		try {
			await changeLocale(
				{
					i18n: this.i18n,
					auth: this.auth,
					userService: this.userService,
					localStorage: this.localStorage,
				},
				lang,
			)
		} catch (err) {
			// changeLocale throws TypeError when `lang` is not in
			// SUPPORTED_LANGUAGES. That path is unreachable from this caller
			// — the selector only forwards values from `supportedLanguages`
			// — so any TypeError reaching here indicates a programmer error
			// (e.g. the constant was edited inconsistently with the
			// validation). Surfacing it to the global error boundary is the
			// intended behavior. Snack is only for genuine network /
			// server-side failures (ConnectError).
			if (!(err instanceof ConnectError)) throw err
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
		// No manual `this.currentLocale = ...` — the getter derives from
		// userService.current.preferredLanguage, which changeLocale's
		// updatePreferredLanguage write-through has already updated.
		this.logger.info('Language changed', { from: previous, to: lang })
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

	/** Toggle discovery sound effects on/off. */
	public toggleSound(): void {
		this.soundEnabled = !this.soundEnabled
		this.audio.setMuted(!this.soundEnabled)
	}

	/** Live-apply the volume slider (0–100) to the audio engine on every tick. */
	public onSoundVolumeInput(): void {
		this.audio.setVolume(this.soundVolume / 100)
	}

	/** Persist the volume once when the user releases the slider. */
	public onSoundVolumePersist(): void {
		this.audio.persistVolume()
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
