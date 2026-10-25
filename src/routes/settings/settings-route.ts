import { I18N } from '@aurelia/i18n'
import { IRouter, type Params, type RouteNode } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve, watch } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import { ILocalStorage } from '../../adapter/storage/local-storage'
import type { UserHomeSelector } from '../../components/user-home-selector/user-home-selector'
import { IAppConfig } from '../../config/app-config'
import { codeToHome, translationKey } from '../../constants/iso3166'
import {
	dedupeStrengthLabelKey,
	type IdentityVerification,
	isVerified,
	verificationMethodLabelKey,
} from '../../entities/identity-verification'
import type { User } from '../../entities/user'
import {
	type ConsentPurpose,
	IConsentService,
} from '../../lib/consent/consent-service'
import { toDomesticDisplay, toE164 } from '../../lib/to-e164'
import { IAudioEngine } from '../../services/audio-engine'
import { IAuthService } from '../../services/auth-service'
import {
	IErrorBoundaryService,
	REPORT_EMAIL_ADDRESS,
} from '../../services/error-boundary-service'
import { IFabMenuService } from '../../services/fab-menu-service'
import { IIdentityVerificationService } from '../../services/identity-verification-service'
import { PASSKEY_MANAGEMENT_PATH } from '../../services/passkey-auth-service'
import { IPushService } from '../../services/push-service'
import { IUserStore } from '../../services/user-store'
import {
	changeLocale,
	currentLanguage,
	SUPPORTED_LANGUAGES,
} from '../../util/change-locale'

export class SettingsRoute {
	/** The privacy and analytics section, for opening the screen at it. */
	public analyticsSection: HTMLElement | undefined
	private openAtAnalytics = false
	public readonly auth = resolve(IAuthService)
	private readonly userStore = resolve(IUserStore)
	private readonly storage = resolve(ILocalStorage)
	private readonly pushService = resolve(IPushService)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')
	private readonly errorBoundary = resolve(IErrorBoundaryService)
	private readonly ea = resolve(IEventAggregator)
	private readonly i18n = resolve(I18N)
	private readonly router = resolve(IRouter)
	private readonly audio = resolve(IAudioEngine)
	private readonly appConfig = resolve(IAppConfig)
	// 本人確認 (identity verification, identity-ekyc-jpki, Stamp flow). Public
	// so the template can bind `identityVerifications.current` directly (mirrors
	// the `auth` / `consent` exposure pattern). The service drives the
	// PocketSign Stamp redirect flow — start() redirects the browser to the
	// PocketSign app.
	public readonly identityVerifications = resolve(IIdentityVerificationService)
	// Public so the template binds the opt-out toggles to the service's
	// `@observable` state directly (`consent.analytics` /
	// `consent.sessionReplay`) — no component-local mirror. Mirrors the
	// `auth` exposure pattern. Both default ON under the opt-out model.
	public readonly consent = resolve(IConsentService)
	// Public so the left-handed-mode toggle binds the launcher placement
	// (`fabMenu.isLeftHanded`) directly; toggleHanded() persists via the storage
	// adapter (mirrors the consent/auth exposure pattern).
	public readonly fabMenu = resolve(IFabMenuService)

	public soundEnabled = !this.audio.muted
	public soundVolume = Math.round(this.audio.volume * 100)
	public notificationsEnabled = false
	public vapidAvailable = !!resolve(IAppConfig).vapidPublicKey
	public homeSelector!: UserHomeSelector
	public languageSelectorOpen = false
	public readonly supportedLanguages = SUPPORTED_LANGUAGES
	private isToggling = false

	public resendSuccess = false

	/**
	 * The name and phone number shown on the fan's tickets, as typed in the
	 * form. Seeded from the saved User; the phone in the domestic form the fan
	 * types (`090-1234-5678`), sent as E.164.
	 */
	public fullName = ''
	public phoneNumber = ''
	/** Set by a save attempt, so field errors appear only after one. */
	public personalDetailsSubmitted = false
	/** The form values last seeded from the saved User. */
	private personalDetailsSeed = { fullName: '', phoneNumber: '' }

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

	/** The identity provider's current verification state of the address. */
	public get emailVerified(): boolean {
		return this.auth.emailVerified
	}

	// ── 本人確認 (identity verification, identity-ekyc-jpki) ───────────────────
	// These getters derive from the service's observable `current`, so the badge
	// and detail rows re-evaluate in place when verification completes — no
	// component-local mirror (mirrors the UserStore-derived getters above).

	/** Whether the fan has an Active IdentityVerification. */
	public get isVerified(): boolean {
		return isVerified(this.identityVerifications.current)
	}

	/** The fan's IdentityVerification, present only when it is Active. */
	private get activeIdentityVerification(): IdentityVerification | undefined {
		return this.isVerified ? this.identityVerifications.current : undefined
	}

	/** i18n key for the verified method (JPKI / driver's licence), or null. */
	public get verificationMethodKey(): string | null {
		const iv = this.activeIdentityVerification
		return iv ? verificationMethodLabelKey(iv.method) : null
	}

	/** i18n key for the dedupe strength (strong / weak), or null. */
	public get dedupeStrengthKey(): string | null {
		const iv = this.activeIdentityVerification
		return iv ? dedupeStrengthLabelKey(iv.dedupeStrength) : null
	}

	/**
	 * Why the last return from the PocketSign app did not verify the fan, as an
	 * i18n key, kept until the fan starts again. None once the fan is verified:
	 * reopening the callback after a success finds no session but is no failure.
	 */
	public get identityFailureKey(): string | null {
		const failure = this.identityVerifications.failure
		if (this.isVerified || !failure) return null
		return `verifyCallback.error.${failure}`
	}

	/** A card already used by another account cannot be retried here. */
	public get identityFailureNeedsSupport(): boolean {
		return (
			this.identityFailureKey !== null &&
			this.identityVerifications.failure === 'alreadyVerified'
		)
	}

	/** Whether 本人確認する is offered. */
	public get canStartIdentityVerification(): boolean {
		return !this.isVerified && !this.identityFailureNeedsSupport
	}

	public readonly supportEmail = REPORT_EMAIL_ADDRESS

	// ── Name and phone number on the tickets (UserService.Update) ─────────────

	/** The signed-in fan's saved User; watched to seed the form once it loads. */
	public get savedUser(): User | undefined {
		return this.userStore.current
	}

	/** The phone number as E.164, or null when it is not a valid number. */
	private get phoneE164(): string | null {
		return toE164(this.phoneNumber)
	}

	/** True when the form differs from the saved values. */
	public get personalDetailsChanged(): boolean {
		return (
			this.fullName.trim() !== (this.savedUser?.fullName ?? '') ||
			(this.phoneE164 ?? this.phoneNumber.trim()) !==
				(this.savedUser?.phoneNumber ?? '')
		)
	}

	/**
	 * The name cannot be cleared: `UserService.Update` keeps a value it is not
	 * given, so an empty name is only valid while none is saved.
	 */
	public get nameInvalid(): boolean {
		return (
			this.personalDetailsSubmitted &&
			this.fullName.trim() === '' &&
			!!this.savedUser?.fullName
		)
	}

	/** A typed phone number must be a domestic or E.164 number. */
	public get phoneInvalid(): boolean {
		if (!this.personalDetailsSubmitted) return false
		if (this.phoneNumber.trim() === '') return !!this.savedUser?.phoneNumber
		return this.phoneE164 === null
	}

	@watch((vm: SettingsRoute) => vm.savedUser)
	public savedUserChanged(): void {
		// Re-seed only while the fan has not edited the form, so a late profile
		// load fills the fields without overwriting what they typed.
		if (
			this.fullName === this.personalDetailsSeed.fullName &&
			this.phoneNumber === this.personalDetailsSeed.phoneNumber
		) {
			this.seedPersonalDetails()
		}
	}

	private seedPersonalDetails(): void {
		const user = this.savedUser
		this.personalDetailsSeed = {
			fullName: user?.fullName ?? '',
			phoneNumber: user?.phoneNumber ? toDomesticDisplay(user.phoneNumber) : '',
		}
		this.fullName = this.personalDetailsSeed.fullName
		this.phoneNumber = this.personalDetailsSeed.phoneNumber
		this.personalDetailsSubmitted = false
	}

	/**
	 * Save the changed name, phone number or both with `UserService.Update`.
	 * Only the changed fields are sent; the phone number is sent as E.164.
	 */
	public async savePersonalDetails(): Promise<void> {
		this.personalDetailsSubmitted = true
		if (this.nameInvalid || this.phoneInvalid) return

		const saved = this.savedUser
		const fullName = this.fullName.trim()
		const phoneNumber = this.phoneE164
		const details: { fullName?: string; phoneNumber?: string } = {}
		if (fullName !== '' && fullName !== (saved?.fullName ?? '')) {
			details.fullName = fullName
		}
		if (phoneNumber && phoneNumber !== (saved?.phoneNumber ?? '')) {
			details.phoneNumber = phoneNumber
		}
		if (details.fullName === undefined && details.phoneNumber === undefined) {
			this.personalDetailsSubmitted = false
			return
		}

		try {
			await this.userStore.updatePersonalDetails(details)
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			this.logger.error('Failed to save the name and phone number', {
				error: err,
			})
			this.ea.publish(
				new Snack(this.i18n.tr('settings.personalDetails.saveError'), 'error'),
			)
			return
		}
		this.seedPersonalDetails()
		this.ea.publish(
			new Snack(this.i18n.tr('settings.personalDetails.saved'), 'info'),
		)
	}

	public binding(): void {
		// Fill the name and phone fields from the saved User. A User that loads
		// later fills them through `savedUserChanged`.
		this.seedPersonalDetails()
	}

	public loading(_params?: Params, next?: RouteNode): void {
		// `?section=analytics` (the Welcome analytics notice) opens the screen at
		// the analytics opt-out.
		this.openAtAnalytics = next?.queryParams.get('section') === 'analytics'
		// Opt-out toggles bind `consent.analytics` / `consent.sessionReplay`
		// (the service's `@observable` state) directly, so first paint reflects
		// the default-on posture or a prior opt-out with no seeding here.
		//
		// Both loads are fire-and-forget. The router awaits `loading()` before
		// swapping the view, so awaiting an RPC here holds the OUTGOING screen
		// frozen until the network answers — on a slow connection, for seconds.
		// Settings is a bottom-nav tab, so the non-blocking contract applies to it
		// exactly as it does to the other tabs; it only escaped because the
		// capability named the three tabs that existed when it was written.
		// Neither value gates the page: the toggles and the badge fill in when
		// their state arrives.
		void this.resolveNotificationToggleState()
		void this.loadIdentityVerification()
		// The badge reads the current state on opening, and again whenever the
		// fan returns to the tab (e.g. after verifying on their phone).
		void this.auth.refreshEmailVerified()
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)
		this.announceIdentityVerified()
		if (this.openAtAnalytics) {
			this.analyticsSection?.scrollIntoView({ block: 'start' })
		}
	}

	public detaching(): void {
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
	}

	private readonly onVisibilityChange = (): void => {
		if (document.visibilityState !== 'visible') return
		void this.auth.refreshEmailVerified()
	}

	/** The success snackbar, once, when the fan arrives from a verified callback. */
	private announceIdentityVerified(): void {
		if (!this.identityVerifications.takeVerifiedNotice()) return
		this.ea.publish(
			new Snack(this.i18n.tr('verifyCallback.success.heading'), 'info', {
				icon: 'shield-check',
			}),
		)
	}

	/**
	 * Load the caller's IdentityVerification for the ACCOUNT-section badge.
	 * Only `IdentityVerificationService.Get` reaches the backend (Start / Create
	 * are backend-stubbed → UNAVAILABLE today); a failure here is non-fatal —
	 * the rest of Settings must still render — so it is logged, not surfaced.
	 */
	private async loadIdentityVerification(): Promise<void> {
		if (!this.auth.isAuthenticated) return
		try {
			await this.identityVerifications.get()
		} catch (err) {
			this.logger.warn('Failed to load the identity verification', {
				error: err,
			})
		}
	}

	/**
	 * 本人確認 entry point for the PocketSign Stamp flow. Calls
	 * `identityVerifications.start()`, which in turn calls
	 * IdentityVerificationService.Start,
	 * persists the session_id, and navigates the browser to the PocketSign app.
	 * The browser navigates away immediately — the method does not return to the
	 * caller after the redirect, so there is no branch to handle here beyond error
	 * paths.
	 *
	 * Errors (ConnectError) from Start surface as a snack notification
	 * before the busy-on-click guard releases, mirroring the push-toggle pattern.
	 *
	 * TODO (identity-ekyc 5.2): where a lottery sale REQUIRES verification, an
	 * apply-flow would prompt the fan to verify before applying — there is no
	 * first-party apply flow in the frontend yet, so no prompt is wired here.
	 * TODO (identity-ekyc 5.3): the 運転免許証 fallback (Verify CardInfo) picks a
	 * method other than JPKI; no method picker is built (post-MVP).
	 */
	public async startIdentityVerification(): Promise<void> {
		const outcome = await this.identityVerifications.start('jpki')
		switch (outcome.kind) {
			case 'redirecting':
				// The browser is navigating to the PocketSign app. Nothing further
				// to do in this method — the callback route handles the return leg.
				this.logger.info('Redirecting to PocketSign for identity verification')
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

	private writeConsent(purpose: ConsentPurpose, enabled: boolean): void {
		this.errorBoundary.addBreadcrumb('action', 'change_consent')
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
		const state = await this.pushService.resolvePushState(
			this.userStore.current !== undefined,
		)
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
					storage: this.storage,
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
			if (!this.userStore.current) {
				this.logger.warn(
					'Cannot toggle push notifications before the account is loaded',
				)
				return
			}

			if (newValue) {
				const endpoint = await this.pushService.create('settings')
				if (!endpoint) {
					// User declined the permission prompt or VAPID key is missing.
					this.notificationsEnabled = false
					return
				}
				this.notificationsEnabled = true
			} else {
				try {
					await this.pushService.delete()
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

	/**
	 * Open passkey management. Its route asks the hosted login for a fresh
	 * sign-in when the passkey-management token is missing.
	 */
	public async openPasskeys(): Promise<void> {
		await this.router.load(PASSKEY_MANAGEMENT_PATH)
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
		this.errorBoundary.addBreadcrumb('action', 'start_sign_in')
		await this.auth.signIn({
			uiLocales: currentLanguage(this.i18n),
			source: 'settings',
		})
	}

	/** Guest auth entry — start the OIDC sign-up flow from Settings. */
	public async signUp(): Promise<void> {
		this.errorBoundary.addBreadcrumb('action', 'start_sign_up')
		await this.auth.signUp({
			uiLocales: currentLanguage(this.i18n),
			source: 'settings',
		})
	}

	public async signOut(): Promise<void> {
		try {
			// AuthService publishes SignedOut before the redirect; every store
			// (UserStore included) clears its own state on it.
			await this.auth.signOut()
		} catch (err) {
			this.logger.error('Sign-out failed', { error: err })
			this.ea.publish(new Snack(this.i18n.tr('settings.signOutError'), 'error'))
		}
	}
}
