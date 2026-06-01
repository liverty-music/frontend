import { I18N, Signals } from '@aurelia/i18n'
import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import {
	loadHome,
	loadLanguage,
	saveHome,
	saveLanguage,
} from '../adapter/storage/guest-storage'
import { clearAllHelpSeen } from '../adapter/storage/onboarding-storage'
import { normalizeToSupportedLanguage } from '../util/change-locale'
import { IAuthService } from './auth-service'
import { IUserService } from './user-service'

export const IUserStore = DI.createInterface<IUserStore>('IUserStore', (x) =>
	x.singleton(UserStore),
)

export interface IUserStore extends UserStore {}

/**
 * Observable owner of the current user's `home` and `preferredLanguage`,
 * resolving guest (localStorage) vs authenticated (backend) sources
 * INTERNALLY so callers never branch on `auth.isAuthenticated`.
 *
 * Phase 4 of the entity-store layer: the guest `home` / `language` slice that
 * used to live behind `GuestService` now lives here directly as `@observable`
 * fields, hydrated from the low-level `guest-storage` adapter on construction
 * and persisted through `*Changed` hooks. UserStore COMPOSES the existing
 * `IUserService` (the authenticated `User` entity, with its cache→Get→Create +
 * write-through logic intact) for the authenticated source.
 *
 * Every exposed value depends ONLY on observable state:
 *   - `userService.current` is @observable.
 *   - `guestHome` / `guestLanguage` are @observable.
 *   - `i18nLocale` mirrors the active i18n locale, kept in sync via the
 *     i18n locale-changed event, so even the authed-NULL fallback is
 *     reactive (a render-time `i18n.getLocale()` read is not observable and
 *     would freeze the binding).
 */
export class UserStore {
	private readonly logger = resolve(ILogger).scopeTo('UserStore')
	private readonly userService = resolve(IUserService)
	private readonly auth = resolve(IAuthService)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)

	/**
	 * Guest (unauthenticated) home area (ISO 3166-2 code). First-class
	 * @observable owner, hydrated from localStorage and persisted via
	 * `guestHomeChanged`, so any binding that reads the guest home re-evaluates
	 * when it changes.
	 */
	@observable public guestHome: string | null = loadHome()

	/**
	 * Anonymous-period UI language (ISO 639-1 code). First-class @observable
	 * owner, symmetric with `guestHome`, so any binding that reads the guest
	 * language re-evaluates when it changes (fixes the guest language-selector
	 * reactivity bug where the selector was driven by an unobservable
	 * `i18n.getLocale()` read). `null` means "no explicit guest choice yet" —
	 * `currentLanguage` falls back to the active i18n locale in that case.
	 */
	@observable public guestLanguage: string | null = loadLanguage()

	/**
	 * Reactive mirror of the active i18n locale, normalized to a supported
	 * code. Seeded from the current locale and updated whenever i18n publishes
	 * a locale change. Used as the observable fallback for the authed-NULL and
	 * guest-unset paths — replacing the unobservable `i18n.getLocale()` read
	 * that froze the guest selector highlight.
	 */
	@observable private i18nLocale: string = normalizeToSupportedLanguage(
		this.i18n.getLocale(),
	)

	constructor() {
		// The i18n subsystem publishes `{ oldLocale, newLocale }` on this EA
		// channel after every successful setLocale. Mirroring it into an
		// @observable is what makes `currentLanguage` re-evaluate for the
		// guest/authed-NULL paths without a render-time getLocale() read.
		this.ea.subscribe(
			Signals.I18N_EA_CHANNEL,
			(payload: { oldLocale: string; newLocale: string }) => {
				this.i18nLocale = normalizeToSupportedLanguage(payload.newLocale)
			},
		)
	}

	/**
	 * The current user's home area (ISO 3166-2 level1 code), or `null` when
	 * unset. Authenticated: the backend `User.home.level1`. Guest: the
	 * observable guest home. Resolved internally — callers must NOT branch on
	 * auth state.
	 */
	public get currentHome(): string | null {
		if (this.auth.isAuthenticated) {
			return this.userService.current?.home?.level1 ?? null
		}
		return this.guestHome
	}

	/**
	 * The current user's effective preferred language (ISO 639-1 code).
	 *
	 * Authenticated: `User.preferredLanguage`, normalized to a SUPPORTED code
	 * so a non-supported backend tag ('en-US') still maps to a value the
	 * selector can highlight ('en'). When the row's preference is NULL/undefined
	 * (historical rows pending backfill), falls back to the observable
	 * `i18nLocale` mirror. Persisting that NULL → backfill is owned solely by
	 * `user-hydration-task` (an activating AppTask); this getter is a PURE
	 * projection of observable state and never issues an RPC.
	 *
	 * Guest: the observable guest language, or the i18n locale mirror when the
	 * guest has not made an explicit choice yet.
	 *
	 * NEVER reads a render-time `i18n.getLocale()`; every branch resolves to
	 * observable state so dependent bindings re-evaluate on change.
	 */
	public get currentLanguage(): string {
		if (this.auth.isAuthenticated) {
			const preferred = this.userService.current?.preferredLanguage
			if (preferred) return normalizeToSupportedLanguage(preferred)
			// NULL server preferred_language: surface the active locale. The
			// hydration task owns the one-shot backfill RPC, so this getter
			// stays side-effect-free and safe to re-evaluate on every pass.
			return this.i18nLocale
		}
		return this.guestLanguage ?? this.i18nLocale
	}

	/**
	 * Set the guest home area (ISO 3166-2 code). Persisted via
	 * `guestHomeChanged`. Used by the unauthenticated home-selection paths
	 * (onboarding home selector, dashboard region setup).
	 */
	public setGuestHome(code: string): void {
		this.guestHome = code
		this.logger.info('Local home set', { home: code })
	}

	/**
	 * Set the guest language (ISO 639-1 code). Persisted via
	 * `guestLanguageChanged`. Used by the unauthenticated locale-change path
	 * (`changeLocale`).
	 */
	public setGuestLanguage(lang: string): void {
		this.guestLanguage = lang
		this.logger.info('Local language set', { language: lang })
	}

	/**
	 * Reset the guest home/language slice plus the per-page help-seen flags.
	 * Used by the welcome route's fresh-tutorial reset and the sign-up
	 * onboarding hand-off. Does NOT touch the follow queue (owned by
	 * FollowStore) and does NOT erase the i18next detector's own `language`
	 * key — only the dedicated `guest.language` key is cleared (it is already
	 * decoupled), preserving the cancelled-login behavior.
	 */
	public clearGuest(): void {
		this.guestHome = null
		this.guestLanguage = null
		clearAllHelpSeen()
		this.logger.info('Local home/language preferences cleared')
	}

	/**
	 * Persist guest home to localStorage on change.
	 */
	public guestHomeChanged(newValue: string | null): void {
		saveHome(newValue)
	}

	/**
	 * Persist guest language to localStorage on change.
	 */
	public guestLanguageChanged(newValue: string | null): void {
		saveLanguage(newValue)
	}
}
