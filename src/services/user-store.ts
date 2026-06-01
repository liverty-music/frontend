import { I18N, Signals } from '@aurelia/i18n'
import { DI, IEventAggregator, observable, resolve } from 'aurelia'
import { normalizeToSupportedLanguage } from '../util/change-locale'
import { IAuthService } from './auth-service'
import { IGuestService } from './guest-service'
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
 * This is the Phase 1 scaffold of the entity-store layer: it COMPOSES the
 * existing `IUserService` (the authenticated `User` entity, with its
 * cache→Get→Create + write-through logic intact) and `IGuestService` (the
 * observable guest preference source). Full absorption / deletion of
 * `UserService` and `GuestService` is deferred to later phases.
 *
 * Every exposed value depends ONLY on observable state:
 *   - `userService.current` is @observable.
 *   - `guest.home` / `guest.language` are @observable.
 *   - `i18nLocale` mirrors the active i18n locale, kept in sync via the
 *     i18n locale-changed event, so even the authed-NULL fallback is
 *     reactive (a render-time `i18n.getLocale()` read is not observable and
 *     would freeze the binding).
 */
export class UserStore {
	private readonly userService = resolve(IUserService)
	private readonly guest = resolve(IGuestService)
	private readonly auth = resolve(IAuthService)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)

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
		return this.guest.home
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
		return this.guest.language ?? this.i18nLocale
	}
}
