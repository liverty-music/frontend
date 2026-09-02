import { I18N } from '@aurelia/i18n'
import { IRouter } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { Snack } from '../../components/snack-bar/snack'
import type { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { IAppConfig } from '../../config/app-config'
import { codeToHome, translationKey } from '../../constants/iso3166'
import {
	dedupeStrengthLabelKey,
	type MyVerificationStatus,
	verificationMethodLabelKey,
} from '../../entities/verified-identity'
import {
	type ConsentPurpose,
	IConsentService,
} from '../../lib/consent/consent-service'
import { IAudioEngine } from '../../services/audio-engine'
import { IAuthService } from '../../services/auth-service'
import { IIdentityVerificationService } from '../../services/identity-verification-service'
import { IPushService } from '../../services/push-service'
import { IUserStore } from '../../services/user-store'
import { changeLocale, SUPPORTED_LANGUAGES } from '../../util/change-locale'

export class SettingsRoute {
	public readonly auth = resolve(IAuthService)
	private readonly userStore = resolve(IUserStore)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly router = resolve(IRouter)
	private readonly audio = resolve(IAudioEngine)
	private readonly appConfig = resolve(IAppConfig)
	// Identity verification (identity-ekyc-jpki, task 5.1). Public so the
	// template can bind `identity.verifyAvailable` directly (mirrors the `auth`
	// / `consent` exposure pattern).
	public readonly identity = resolve(IIdentityVerificationService)
	// Public so the template binds the opt-out toggles to the service's
	// `@observable` state directly (`consent.analytics` /
	// `consent.sessionReplay`) — no component-local mirror. Mirrors the
	// `auth` exposure pattern. Both default ON under the opt-out model.
	public readonly consent = resolve(IConsentService)

	public soundEnabled = !this.audio.muted
	public soundVolume = Math.round(this.audio.volume * 100)
	public notificationsEnabled = false
	public vapidAvailable = !!resolve(IAppConfig).vapidPublicKey
	public homeSelector!: UserHomeSelector
	public languageSelectorOpen = false
	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	private isToggling = false

	/**
	 * Per-row disclosure state for the Privacy & Analytics opt-out
	 * descriptions. The description is hidden until the user expands it,
	 * keeping each card compact while the full rationale stays one tap away.
	 * Kept separate from the switch value so the disclosure and the switch
	 * remain independent sibling controls (accessible: a `role="switch"`
	 * button never nests another interactive element).
	 */
	public analyticsDescExpanded = false
	public sessionReplayDescExpanded = false

	public resendSuccess = false

	/**
	 * Whether to show the "本人確認は近日対応予定です (verification coming soon)"
	 * note. Set when the fan taps "verify identity" while the Pocket Sign Verify
	 * SDK is not yet integrated (Section 0) — a friendly state, not a broken flow.
	 */
	public verificationComingSoon = false

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

	// ── Identity verification (identity-ekyc-jpki, task 5.1) ──────────────────
	// These getters derive from the service's observable `status`, so the badge
	// and detail rows re-evaluate in place when verification completes — no
	// component-local mirror (mirrors the UserStore-derived getters above).

	/** Whether the account is IDENTITY_VERIFIED. */
	public get isIdentityVerified(): boolean {
		return this.identity.status?.level === 'identityVerified'
	}

	/** The backing verification, present only when verified. */
	private get verifiedIdentity(): MyVerificationStatus['identity'] {
		return this.isIdentityVerified ? this.identity.status?.identity : undefined
	}

	/** i18n key for the verified method (JPKI / driver's licence), or null. */
	public get verificationMethodKey(): string | null {
		const vi = this.verifiedIdentity
		return vi ? verificationMethodLabelKey(vi.method) : null
	}

	/** i18n key for the dedupe strength (strong / weak), or null. */
	public get dedupeStrengthKey(): string | null {
		const vi = this.verifiedIdentity
		return vi ? dedupeStrengthLabelKey(vi.dedupeStrength) : null
	}

	public async loading(): Promise<void> {
		// Opt-out toggles bind `consent.analytics` / `consent.sessionReplay`
		// (the service's `@observable` state) directly, so first paint reflects
		// the default-on posture or a prior opt-out with no seeding here.
		await this.resolveNotificationToggleState()
		await this.loadVerificationStatus()
	}

	/**
	 * Load the caller's verification status for the ACCOUNT-section badge. Only
	 * `getMyVerificationStatus` reaches the backend (StartVerify / CompleteVerify
	 * are backend-stubbed → UNAVAILABLE today); a failure here is non-fatal — the
	 * rest of Settings must still render — so it is logged, not surfaced.
	 */
	private async loadVerificationStatus(): Promise<void> {
		if (!this.auth.isAuthenticated) return
		try {
			await this.identity.getMyVerificationStatus()
		} catch (err) {
			this.logger.warn('Failed to load verification status', { error: err })
		}
	}

	/**
	 * "Verify identity" entry point (task 5.1). While the Pocket Sign Verify SDK
	 * is pending onboarding (Section 0) this surfaces a friendly "coming soon"
	 * note rather than starting an un-completable flow. Once the SDK lands, the
	 * `verified` branch drives the badge update in place via the service's
	 * observable `status`.
	 *
	 * TODO (identity-ekyc 5.2): where a lottery phase REQUIRES verification, an
	 * apply-flow would prompt the fan to verify before applying — there is no
	 * first-party apply flow in the frontend yet, so no prompt is wired here.
	 * TODO (identity-ekyc 5.3): the 運転免許証 fallback (Verify CardInfo) picks a
	 * method other than JPKI; no method picker is built (needs the SDK).
	 */
	public async verifyIdentity(): Promise<void> {
		this.verificationComingSoon = false
		const outcome = await this.identity.verify('jpki')
		switch (outcome.kind) {
			case 'vendorUnavailable':
				// Friendly, expected pre-onboarding state.
				this.verificationComingSoon = true
				break
			case 'verified':
				// The observable `status` already updated the badge; nothing to do.
				this.logger.info('Identity verified')
				break
			case 'notAuthenticated':
				// Unreachable from this row (rendered authenticated-only); logged
				// defensively in case the row is ever surfaced to a guest.
				this.logger.warn('Verify requested without an authenticated account')
				break
		}
	}

	/** Toggle the Analytics opt-out; the bound observable state drives the UI. */
	public handleAnalyticsToggle(): void {
		this.writeConsent('analytics', !this.consent.analytics)
	}

	/** Toggle the Session-replay opt-out (recording only; events unaffected). */
	public handleSessionReplayToggle(): void {
		this.writeConsent('sessionReplay', !this.consent.sessionReplay)
	}

	/** Toggle the Analytics opt-out description disclosure. */
	public toggleAnalyticsDesc(): void {
		this.analyticsDescExpanded = !this.analyticsDescExpanded
	}

	/** Toggle the Session-replay opt-out description disclosure. */
	public toggleSessionReplayDesc(): void {
		this.sessionReplayDescExpanded = !this.sessionReplayDescExpanded
	}

	private writeConsent(purpose: ConsentPurpose, enabled: boolean): void {
		if (enabled) {
			this.consent.grant(purpose)
		} else {
			this.consent.revoke(purpose)
		}
		this.logger.info('Opt-out setting changed', { purpose, enabled })
	}

	/**
	 * Derives the push notifications toggle state via the push-service recovery
	 * pass, which reconciles the browser subscription with the backend in both
	 * directions without user interaction:
	 *   - browser has a subscription the backend is missing → re-register it;
	 *   - permission granted but the browser has no subscription → auto
	 *     re-subscribe (no silent OFF for a permission-granted user);
	 *   - permission not granted → OFF, and the enable toggle stays the
	 *     re-enable affordance.
	 * A subscribe/register failure reflects OFF (never a false success).
	 */
	private async resolveNotificationToggleState(): Promise<void> {
		const userId = this.userStore.current?.id ?? ''
		const state = await this.pushService.resolvePushState(userId || undefined)
		this.notificationsEnabled = state === 'enabled'
		if (state === 'error') {
			// Non-silent: the recovery already logged the cause; reflect the
			// failure to the user so a believed-ON state is not shown as success.
			this.ea.publish(
				new Snack(this.i18n.tr('settings.notificationError'), 'error'),
			)
		}
	}

	public openHomeSelector(): void {
		this.homeSelector.open()
	}

	public async onHomeSelected(code: string): Promise<void> {
		// UserHomeSelector is now a pure selection UI — the caller owns
		// persistence. Authenticated users write through UserService.updateHome;
		// guests persist to localStorage via setGuestHome. `currentHome` is
		// derived from the store, so the view updates reactively afterwards.
		this.logger.info('Home area updated from settings', { code })
		if (this.auth.isAuthenticated) {
			try {
				await this.userStore.updateHome(codeToHome(code))
			} catch (err) {
				this.logger.error('Failed to update home via RPC', err)
			}
		} else {
			this.userStore.setGuestHome(code)
		}
	}

	public openLanguageSelector(): void {
		this.languageSelectorOpen = true
	}

	public async selectLanguage(lang: string): Promise<void> {
		const previous = this.currentLocale
		// Re-selecting the active language is a no-op: just close, no RPC.
		if (lang === previous) {
			this.languageSelectorOpen = false
			return
		}
		try {
			await changeLocale(
				{
					i18n: this.i18n,
					auth: this.auth,
					userStore: this.userStore,
				},
				lang,
			)
		} catch (err) {
			// changeLocale throws TypeError when `lang` is not in
			// SUPPORTED_LANGUAGES. That path is unreachable from this caller
			// — the selector only forwards values from `supportedLanguages`
			// — so any TypeError reaching here indicates a programmer error
			// (e.g. the constant was edited inconsistently with the
			// validation). Surface it to the global error boundary WITHOUT
			// closing the sheet, so the failure is not masked as a successful
			// dismissal with the row still showing the old language. Snack is
			// only for genuine network / server-side failures (ConnectError).
			if (!(err instanceof ConnectError)) throw err
			this.logger.error('Failed to update preferred language', {
				error: err,
				from: previous,
				to: lang,
			})
			this.ea.publish(
				new Snack(this.i18n.tr('settings.languageChangeError'), 'error'),
			)
			// Genuine network/server failure: close the sheet — the Snack
			// explains why the (unchanged) row still reads the old language.
			this.languageSelectorOpen = false
			return
		}
		// Close only after the change is applied. No manual `this.currentLocale =
		// ...` — the getter derives from UserStore.currentLanguage, an observable
		// updated by changeLocale's write-through.
		this.languageSelectorOpen = false
		this.logger.info('Language changed', { from: previous, to: lang })
	}

	public async toggleNotifications(): Promise<void> {
		// The push row uses `aria-disabled` (not native `disabled`) when the
		// VAPID key is absent, so it stays AT-discoverable but must no-op here.
		if (!this.vapidAvailable) return
		// `busy-on-click` guards DOM re-taps; this guard additionally protects
		// against concurrent programmatic calls (push subscription idempotency).
		if (this.isToggling) return
		this.isToggling = true

		try {
			const newValue = !this.notificationsEnabled
			const userId = this.userStore.current?.id ?? ''
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
			// subscribe()/Create failed. Never leave a false success: reflect OFF
			// and surface the failure rather than swallowing it.
			this.logger.error('Failed to toggle push notifications', err)
			this.notificationsEnabled = false
			this.ea.publish(
				new Snack(this.i18n.tr('settings.notificationError'), 'error'),
			)
		} finally {
			this.isToggling = false
		}
	}

	public async resendVerification(): Promise<void> {
		// Re-entrancy and the in-flight busy state are handled by `busy-on-click`.
		this.resendSuccess = false

		try {
			await this.userStore.resendEmailVerification()
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

	/**
	 * Navigate to a legal document page (Terms / Privacy / OSS Licenses).
	 *
	 * Uses the injected root `IRouter` rather than a `load`/`href` attribute:
	 * the attribute resolves its instruction relative to the Settings route's
	 * own routing context, turning `legal/terms` into `/settings/legal/terms`
	 * (no such route → AUR3174). `router.load` resolves from the root context,
	 * so the absolute `/legal/*` path matches the top-level route.
	 */
	public async openLegal(path: string): Promise<void> {
		await this.router.load(path)
	}

	public get releaseVersion(): string {
		return this.appConfig.releaseVersion ?? '—'
	}

	public async copyVersion(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.releaseVersion)
			this.ea.publish(
				new Snack(this.i18n.tr('settings.copyVersionSuccess'), 'info'),
			)
		} catch (err) {
			this.logger.warn('Failed to copy version to clipboard', err)
		}
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
			this.userStore.clear()
			await this.auth.signOut()
		} catch (err) {
			this.logger.error('Sign-out failed', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('settings.signOutError'), 'error'))
		}
	}
}
