import { I18N } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { Snack } from '../../components/snack-bar/snack'
import type { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { IAppConfig } from '../../config/app-config'
import { translationKey } from '../../constants/iso3166'
import {
	type ConsentPurpose,
	IConsentService,
} from '../../lib/consent/consent-service'
import { IAudioEngine } from '../../services/audio-engine'
import { IAuthService } from '../../services/auth-service'
import { IGuestService } from '../../services/guest-service'
import { INotificationManager } from '../../services/notification-manager'
import { IPushService } from '../../services/push-service'
import { IUserService } from '../../services/user-service'
import { IUserStore } from '../../services/user-store'
import { changeLocale, SUPPORTED_LANGUAGES } from '../../util/change-locale'

export class SettingsRoute {
	public readonly auth = resolve(IAuthService)
	private readonly guest = resolve(IGuestService)
	private readonly userService = resolve(IUserService)
	private readonly userStore = resolve(IUserStore)
	private readonly notificationManager = resolve(INotificationManager)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly audio = resolve(IAudioEngine)
	private readonly consent = resolve(IConsentService)

	public soundEnabled = !this.audio.muted
	public soundVolume = Math.round(this.audio.volume * 100)
	public notificationsEnabled = false
	public vapidAvailable = !!resolve(IAppConfig).vapidPublicKey
	public homeSelector!: UserHomeSelector
	public languageSelectorOpen = false
	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	private isToggling = false

	/**
	 * Local mirror of the consent state used for `aria-checked` + the
	 * `data-on` toggle attribute bindings. Aurelia 2 RC1's binding engine
	 * does not currently re-evaluate a `.bind` expression that calls a
	 * getter through an interface boundary without an `@observable`
	 * trigger, so we mirror the live `IConsentService` state into plain
	 * fields and write back via `handleAnalyticsToggle` /
	 * `handleMarketingToggle`. The mirrors are seeded in `loading()` and
	 * re-synced whenever the user toggles, keeping the UI and service
	 * state in lockstep without introducing an extra subscription.
	 */
	public analyticsConsent = false
	public marketingConsent = false

	/**
	 * Per-row disclosure state for the Privacy & Analytics consent
	 * descriptions. The description is hidden until the user expands it,
	 * keeping each card compact while the full rationale stays one tap away.
	 * Kept separate from the switch value so the disclosure and the switch
	 * remain independent sibling controls (accessible: a `role="switch"`
	 * button never nests another interactive element).
	 */
	public analyticsDescExpanded = false
	public marketingDescExpanded = false

	public isResendingVerification = false
	public resendSuccess = false

	/**
	 * Whether the running platform is iOS/iPadOS. Used to gate the
	 * sound-effects hint, which describes iOS-only silent-switch behaviour
	 * and is noise on Android/desktop. Mirrors the detection in
	 * `pwa-install-service`; defaults to false when uncertain so non-iOS
	 * never sees the iOS-specific copy.
	 */
	public get isIOS(): boolean {
		const ua = navigator.userAgent
		if (/iphone|ipad|ipod/i.test(ua)) return true
		// iPadOS 13+ reports a macOS desktop user-agent; detect via touch.
		return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
	}

	// Display values derive from UserStore, the single observable owner of the
	// current user's home + language. UserStore resolves guest(localStorage)
	// vs authed(backend) INTERNALLY and exposes only observable state, so these
	// getters re-evaluate every dependent binding (settings row text AND the
	// in-modal selector check) without a component-local mirror, an
	// auth-branch, or a render-time i18n.getLocale() read — the latter was the
	// root cause of the frozen guest language-selector highlight.
	public get currentLocale(): string {
		return this.userStore.currentLanguage
	}

	public get currentHome(): string | null {
		const code = this.userStore.currentHome
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
		// Sync consent toggles before render: a user who flipped them on
		// the onboarding consent screen or on a prior settings visit
		// MUST see the correct state on first paint.
		this.analyticsConsent = this.consent.analytics
		this.marketingConsent = this.consent.marketingMeasurement
		await this.resolveNotificationToggleState()
	}

	/**
	 * Persist an analytics toggle tap. Flipping the local mirror first
	 * keeps the toggle visually responsive — the `ConsentService` write
	 * also publishes `ConsentChanged`, but the AnalyticsService
	 * subscription performs SDK reconfiguration synchronously inside the
	 * publish callback, which would otherwise race the local view state.
	 */
	public handleAnalyticsToggle(): void {
		const next = !this.analyticsConsent
		this.analyticsConsent = next
		this.writeConsent('analytics', next)
	}

	public handleMarketingToggle(): void {
		const next = !this.marketingConsent
		this.marketingConsent = next
		this.writeConsent('marketingMeasurement', next)
	}

	/** Toggle the analytics consent description disclosure. */
	public toggleAnalyticsDesc(): void {
		this.analyticsDescExpanded = !this.analyticsDescExpanded
	}

	/** Toggle the marketing-measurement consent description disclosure. */
	public toggleMarketingDesc(): void {
		this.marketingDescExpanded = !this.marketingDescExpanded
	}

	private writeConsent(purpose: ConsentPurpose, grant: boolean): void {
		if (grant) {
			this.consent.grant(purpose)
		} else {
			this.consent.revoke(purpose)
		}
		this.logger.info('Consent setting changed', { purpose, grant })
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
					guest: this.guest,
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
		// UserStore.currentLanguage, an observable that resolves to the authed
		// User entity (updated by changeLocale's updatePreferredLanguage
		// write-through) or the observable guest language (updated by
		// changeLocale's guest.setLanguage write-through).
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

	/** Guest auth entry — start the OIDC sign-in flow from Settings. */
	public async signIn(): Promise<void> {
		await this.auth.signIn()
	}

	/** Guest auth entry — start the OIDC sign-up flow from Settings. */
	public async signUp(): Promise<void> {
		await this.auth.signUp()
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
