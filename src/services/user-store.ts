import { I18N, Signals } from '@aurelia/i18n'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, IEventAggregator, ILogger, observable, resolve } from 'aurelia'
import { IUserRpcClient } from '../adapter/rpc/client/user-client'
import { loadHome, saveHome } from '../adapter/storage/guest-storage'
import { clearAllHelpSeen } from '../adapter/storage/onboarding-storage'
import type { User } from '../entities/user'
import { normalizeToSupportedLanguage } from '../util/change-locale'
import { IAuthService } from './auth-service'
import { SignedOut } from './events/signed-out'

export const IUserStore = DI.createInterface<IUserStore>('IUserStore', (x) =>
	x.singleton(UserStore),
)

export interface IUserStore extends UserStore {}

/**
 * Outcome of a provisioning call (`ensureLoaded` / `create`).
 *
 * `created` reports whether this call provisioned a GENUINELY NEW backend
 * account, as opposed to resolving a pre-existing one. The store first reads
 * the caller's User (`UserService.Get`) and calls the idempotent `Create` only
 * when the server answers NotFound, so `created` is the server's own answer,
 * not a guess from local storage. The auth callback AND-narrows the
 * post-signup dialog gate (keyed on the OIDC sign-up flow) with it, so a
 * returning user who taps "Sign up" is not treated as new.
 */
export interface ProvisionResult {
	user: User | undefined
	/** True only when this call minted a brand-new backend account. */
	created: boolean
}

/**
 * Observable owner of the current user's `home` and `preferredLanguage`,
 * resolving guest (localStorage) vs authenticated (backend) sources
 * INTERNALLY so callers never branch on `auth.isAuthenticated`.
 *
 * Phase 5b of the entity-store layer: the authenticated `User` entity (with its
 * Get→Create chain and write-through update methods) used to live behind a
 * separate `UserService`. UserStore now
 * OWNS that logic directly, making it the single owner of the User entity in
 * addition to the guest `home` slice it already owned (that still lives here as
 * an `@observable` field, hydrated from the low-level `guest-storage` adapter on
 * construction and persisted through its `*Changed` hook).
 *
 * Every exposed value depends ONLY on observable state:
 *   - `current` is @observable.
 *   - `guestHome` is @observable.
 *   - `i18nLocale` mirrors the active i18n locale, kept in sync via the
 *     i18n locale-changed event. It is the single source of truth for the
 *     guest locale and the authed-NULL fallback (a render-time
 *     `i18n.getLocale()` read is not observable and would freeze the binding).
 */
export class UserStore {
	private readonly logger = resolve(ILogger).scopeTo('UserStore')
	private readonly rpcClient = resolve(IUserRpcClient)
	private readonly auth = resolve(IAuthService)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)

	// `current` is the single source of truth for the authenticated user
	// entity. Marked @observable so any view-model that binds to
	// `userStore.current` (directly OR through a computed getter such as
	// SettingsRoute.currentLocale / SettingsRoute.currentHome) re-evaluates
	// automatically when the entity changes — no component-local mirror
	// state, no manual write-back. Every mutation method below assigns
	// through `this.current = ...` so the notification fires exactly once
	// per change.
	//
	// Why a public @observable field and not `@observable private _current`
	// + `public get current()`:
	// Aurelia 2's expression observer subscribes to the property accessed
	// in the binding AST. For a binding like `userStore.current` it sets
	// up an observer on the `current` member of the store instance. When
	// `current` is a plain field, the @observable setter's synchronous
	// notification is exactly the channel the observer subscribes to —
	// reactivity is direct and predictable. When `current` is a *getter*
	// that returns a separately-@observable `_current`, the observer would
	// need to track the dependency through the getter body, which only
	// works reliably for getters marked `@computed` and for objects under
	// proxy observation; services injected via DI are not guaranteed to be
	// proxied in every config. The encapsulation cost here is small — the
	// `readonly` declaration on `IUserStore.current` is the effective
	// contract for every consumer that resolves via DI, since DI always
	// returns the interface type. Production code never resolves the
	// concrete class.
	@observable public current: User | undefined = undefined

	/**
	 * Guest (unauthenticated) home area (ISO 3166-2 code). First-class
	 * @observable owner, hydrated from localStorage and persisted via
	 * `guestHomeChanged`, so any binding that reads the guest home re-evaluates
	 * when it changes.
	 */
	@observable public guestHome: string | null = loadHome()

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
		// Sign-out and account switch: forget the previous account's User so no
		// later read or write can act on it (design D15 of unify-ticket-sales).
		this.ea.subscribe(SignedOut, () => this.clear())
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
			return this.current?.home?.level1 ?? null
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
	 * Guest: the observable `i18nLocale` mirror, which always equals the active
	 * i18n locale — so the selector highlight can never drift from the rendered
	 * UI. The anonymous locale has a single persisted source
	 * (`localStorage['language']`, the i18next detector cache); there is no
	 * separate guest-language key to reconcile.
	 *
	 * NEVER reads a render-time `i18n.getLocale()`; every branch resolves to
	 * observable state so dependent bindings re-evaluate on change.
	 */
	public get currentLanguage(): string {
		if (this.auth.isAuthenticated) {
			const preferred = this.current?.preferredLanguage
			if (preferred) return normalizeToSupportedLanguage(preferred)
			// NULL server preferred_language: surface the active locale. The
			// hydration task owns the one-shot backfill RPC, so this getter
			// stays side-effect-free and safe to re-evaluate on every pass.
			return this.i18nLocale
		}
		return this.i18nLocale
	}

	// Resolves the authenticated user via:
	//   1. in-memory value (already hydrated this session)
	//   2. UserService.Get for the signed-in caller
	//   3. recovery: idempotent Create using the JWT email when Get answers
	//      NotFound — covers the first sign-up and any boot path
	//      (auth-callback, UserHydrationTask, direct dashboard reload) that needs
	//      a guaranteed user.
	// No request names the user: the backend takes the caller from the token.
	public async ensureLoaded(
		preferredLanguage: string,
	): Promise<ProvisionResult> {
		if (this.current) return { user: this.current, created: false }
		return this.getOrCreate(preferredLanguage)
	}

	/**
	 * Forget the signed-in account's User. Runs on `SignedOut` (sign-out,
	 * forced re-auth, account switch) and is idempotent.
	 */
	public clear(): void {
		this.current = undefined
		this.logger.info('User profile cleared')
	}

	/**
	 * Resolve-or-provision with the guest's home: an existing User is returned
	 * as stored (its home is not overwritten); a new one is created with `home`
	 * so the onboarding choice is saved with the account.
	 */
	public async create(
		email: string,
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
	): Promise<ProvisionResult> {
		// NOTE: the guest-follow migration trigger (GuestMigrationRequested) is
		// published by AuthCallbackRoute on every successful authenticated
		// callback, NOT here, so the trigger stays at a single site.
		return this.getOrCreate(preferredLanguage, home, email)
	}

	private async getOrCreate(
		preferredLanguage: string,
		home?: { countryCode: string; level1: string; level2?: string },
		email: string | undefined = this.auth.user?.profile.email,
	): Promise<ProvisionResult> {
		try {
			this.logger.info('Loading user profile from backend')
			this.current = await this.rpcClient.get()
			return { user: this.current, created: false }
		} catch (err) {
			if (!(err instanceof ConnectError && err.code === Code.NotFound)) {
				throw err
			}
		}

		if (!email) {
			this.logger.warn(
				'No user for this identity and no email in auth claims; cannot bootstrap user',
			)
			return { user: undefined, created: false }
		}

		// Create requires preferred_language; pass the current effective locale
		// so the new row carries the language the visitor was experiencing.
		this.logger.info('Bootstrapping via idempotent Create (no user yet)')
		this.current = await this.rpcClient.create(email, preferredLanguage, home)
		return { user: this.current, created: this.current !== undefined }
	}

	public async updateHome(home: {
		countryCode: string
		level1: string
		level2?: string
	}): Promise<User | undefined> {
		const updated = await this.rpcClient.setHome(home)
		// Same write-through pattern as updatePreferredLanguage: on a
		// populated response use the DB-authoritative entity; on an
		// empty response patch the cached field locally rather than
		// wiping `current` and losing the rest of the profile.
		if (updated) {
			this.current = updated
		} else if (this.current) {
			this.current = { ...this.current, home }
		}
		return this.current
	}

	public async updatePreferredLanguage(
		preferredLanguage: string,
	): Promise<User | undefined> {
		const updated = await this.rpcClient.setPreferredLanguage(preferredLanguage)
		// Use the DB-authoritative entity when the server returned a populated
		// user with a non-empty preferredLanguage. If the server omitted the
		// user field entirely, OR returned a user whose preferredLanguage is
		// missing/empty (the mapper coerces proto3 default "" to undefined,
		// which can happen on a partial proto migration or a misconfigured
		// validator), patch the cached field locally with the value we
		// successfully sent. Wiping `current` with a stale/incomplete entity
		// would break the rest of the session for everyone reading
		// userStore.current.
		if (updated?.preferredLanguage) {
			this.current = updated
		} else if (this.current) {
			this.current = { ...this.current, preferredLanguage }
		}
		return this.current
	}

	/**
	 * Change the full name, phone number or both shown on the fan's tickets
	 * (`UserService.Update`). `phoneNumber` MUST be in E.164 form. The returned
	 * User replaces `current`, so every binding shows the saved values.
	 */
	public async updatePersonalDetails(details: {
		fullName?: string
		phoneNumber?: string
	}): Promise<User | undefined> {
		const updated = await this.rpcClient.update(details)
		if (updated) {
			this.current = updated
		} else if (this.current) {
			this.current = { ...this.current, ...details }
		}
		return this.current
	}

	public async resendEmailVerification(): Promise<void> {
		await this.rpcClient.resendEmailVerification()
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
	 * Reset the guest home slice plus the per-page help-seen flags. Used by the
	 * welcome route's guest reset before sign-in and by the auth callback's
	 * onboarding hand-off once sign-up (or sign-in) completes. Tapping
	 * [Get Started] does not call it.
	 * Does NOT touch the follow queue (owned by FollowStore) and does NOT touch
	 * the locale: the anonymous locale lives solely in the i18next detector's
	 * `language` key, which persists across this reset, preserving the
	 * cancelled-login behavior with no decoupling to reason about.
	 */
	public clearGuest(): void {
		this.guestHome = null
		clearAllHelpSeen()
		this.logger.info('Local home preferences cleared')
	}

	/**
	 * Persist guest home to localStorage on change.
	 */
	public guestHomeChanged(newValue: string | null): void {
		saveHome(newValue)
	}
}
