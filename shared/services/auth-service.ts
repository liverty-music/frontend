import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import {
	type User,
	UserManager,
	type UserManagerSettings,
	WebStorageStateStore,
} from 'oidc-client-ts'
import { type AppConfig, IAppConfig } from '../config/app-config'
import { AuthStarted } from './events/auth-started'
import { SignedOut } from './events/signed-out'

/**
 * The token endpoint rejected the refresh token itself (RFC 6749 §5.2). Read
 * from the error's `error` field (oidc-client-ts `ErrorResponse`).
 */
function isInvalidGrant(err: unknown): boolean {
	return (
		typeof err === 'object' &&
		err !== null &&
		(err as { error?: unknown }).error === 'invalid_grant'
	)
}

/**
 * The scope naming the organization whose login policy applies: by id when the
 * config pins one, otherwise by primary domain (the organizer console's
 * short-name entry), otherwise none.
 */
export function orgScope(config: AppConfig): string {
	if (config.zitadelOrgId)
		return `urn:zitadel:iam:org:id:${config.zitadelOrgId}`
	if (config.zitadelOrgPrimaryDomain) {
		return `urn:zitadel:iam:org:domain:primary:${config.zitadelOrgPrimaryDomain}`
	}
	return ''
}

/**
 * Zitadel's OIDC endpoints, which sit at fixed paths under the issuer (its
 * `/.well-known/openid-configuration` lists the same URLs). Given up front,
 * oidc-client-ts skips fetching that document, which Zitadel serves with
 * `Cache-Control: no-store`: one round trip saved on every sign-in redirect,
 * sign-in callback and token refresh. The JWKS is not used by the client.
 */
export function zitadelMetadata(
	issuer: string,
): UserManagerSettings['metadata'] {
	const base = issuer.replace(/\/+$/, '')
	return {
		issuer: base,
		authorization_endpoint: `${base}/oauth/v2/authorize`,
		token_endpoint: `${base}/oauth/v2/token`,
		userinfo_endpoint: `${base}/oidc/v1/userinfo`,
		end_session_endpoint: `${base}/oidc/v1/end_session`,
		revocation_endpoint: `${base}/oauth/v2/revoke`,
		jwks_uri: `${base}/oauth/v2/keys`,
	}
}

function createSettings(config: AppConfig): UserManagerSettings {
	return {
		authority: config.zitadelIssuer,
		metadata: zitadelMetadata(config.zitadelIssuer),
		client_id: config.zitadelClientId,
		redirect_uri: `${window.location.origin}/auth/callback`,
		post_logout_redirect_uri: `${window.location.origin}/`,
		response_type: 'code',
		scope: [
			'openid profile email offline_access',
			// Include org scope so Zitadel applies the Org-level login policy (passkey only)
			orgScope(config),
		]
			.filter(Boolean)
			.join(' '),
		// PKCE is standard/default for 'code' flow in newer oidc-client-ts versions.
		// The profile comes from the ID token alone: every Zitadel app of this
		// project sets `idTokenUserinfoAssertion` and `idTokenRoleAssertion`
		// (cloud-provisioning `src/zitadel/components`), so the claims the apps
		// read (email, name, preferred_username, project roles) are in it.
		// Calling userinfo cost a CORS preflight and a GET on every sign-in.
		loadUserInfo: false,
		// Use localStorage instead of sessionStorage for better compatibility with Playwright storageState
		userStore: new WebStorageStateStore({ store: window.localStorage }),
		// Disable session monitor in all environments: the self-hosted Zitadel
		// serves check_session_iframe with frame-ancestors 'none', so the hidden
		// iframe cannot load and oidc-client-ts fires spurious userUnloaded events
		// (~10s) that re-bootstrap the entire Aurelia app. Session-change detection
		// degrades to next-token-refresh detection (<=30m), the standard posture
		// for SPAs against a Zitadel that blocks iframe embedding.
		monitorSession: false,
		// Zitadel enforces refresh token rotation — each use invalidates the old token
		// and issues a new one. The background timer races with a SW-triggered page
		// reload: both the old and new page call signinSilent() with the same refresh
		// token, and Zitadel rejects the second with RefreshTokenInvalid. Disable the
		// timer; token refresh occurs on-demand only (boot via restoreSession, 401 via
		// connect-error-router).
		automaticSilentRenew: false,
	}
}

/**
 * Application-defined state round-tripped through the OIDC authorization
 * request via `signinRedirect({ state })`. oidc-client-ts persists it (keyed by
 * the OIDC state id) and returns it intact on the resolved `User.state`, giving
 * the auth-callback a reliable signal of which flow the user initiated.
 */
export interface AuthFlowState {
	/** Set to 'signup' only when the user arrived via `signUp()`. */
	flow?: 'signup'
	/**
	 * Where the sign-up started, when that changes what follows it. A sign-up
	 * from an Event page returns there and skips the post-signup celebration
	 * and dialog (the purchase flow owns its own follow-up prompts).
	 */
	origin?: AuthFlowOrigin
	/**
	 * In-app path to show after the callback. Carried in the OIDC state rather
	 * than sessionStorage so it survives a sign-up that outlasts the
	 * return-to TTL (e.g. waiting for an email verification code).
	 */
	returnTo?: string
}

/** Surfaces that start a sign-up with their own follow-up. */
export type AuthFlowOrigin = 'event-page'

/** Options of {@link AuthService.signUp}. */
export interface SignUpOptions {
	/** In-app path (starting with a single `/`) to return to after sign-up. */
	returnTo?: string
	origin?: AuthFlowOrigin
	/** Language the hosted login should show; see {@link SignInOptions.uiLocales}. */
	uiLocales?: string
	/** Where the start came from; see {@link SignInOptions.source}. */
	source?: string
}

/** Options of {@link AuthService.signIn}. */
export interface SignInOptions {
	loginHint?: string
	forceLogin?: boolean
	/**
	 * In-app path (starting with a single `/`) to show after the callback,
	 * carried in the OIDC state. Read it back with {@link resolveAuthReturnTo}.
	 */
	returnTo?: string
	/**
	 * Language the hosted login should show (OIDC `ui_locales`), i.e. the
	 * language the calling app is showing. Each app resolves it itself: the
	 * admin app has no i18n and sends none, so the hosted login falls back to
	 * the browser language.
	 */
	uiLocales?: string
	/**
	 * The screen or control the start came from, published with
	 * {@link AuthStarted} for the fan app's usage analytics.
	 */
	source?: string
}

/**
 * Read the flow marker off a resolved OIDC user. Returns undefined when no
 * marker is present (a sign-in, or an older in-flight redirect started before
 * this signal existed) — callers MUST treat undefined as "not sign-up".
 */
export function resolveAuthFlow(user: User): AuthFlowState['flow'] {
	return (user.state as AuthFlowState | undefined)?.flow
}

/** Read the sign-up origin marker off a resolved OIDC user, if any. */
export function resolveAuthOrigin(user: User): AuthFlowOrigin | undefined {
	return (user.state as AuthFlowState | undefined)?.origin
}

/**
 * Read the return path carried in the OIDC state, accepting only an in-app
 * path so a tampered state can never redirect off the app.
 */
export function resolveAuthReturnTo(user: User): string | undefined {
	const loc = (user.state as AuthFlowState | undefined)?.returnTo
	return isInAppPath(loc) ? loc : undefined
}

/** True for a same-origin path: one leading `/`, not `//` or a backslash. */
export function isInAppPath(loc: unknown): loc is string {
	return (
		typeof loc === 'string' &&
		loc.startsWith('/') &&
		!loc.startsWith('//') &&
		!loc.includes('\\')
	)
}

/** True when the user's access token is already expired or expires within the
 *  skew window — i.e. it should be refreshed before the next request. */
function isExpiringWithinSkew(user: User): boolean {
	if (user.expires_at == null) return user.expired === true
	const nowSec = Math.floor(Date.now() / 1000)
	return user.expires_at - nowSec <= EXPIRY_SKEW_SEC
}

export const IAuthService = DI.createInterface<IAuthService>(
	'IAuthService',
	(x) => x.singleton(AuthService),
)

export interface IAuthService extends AuthService {}

/** Refresh the token when it expires within this many seconds (skew window). */
const EXPIRY_SKEW_SEC = 60
/** sessionStorage key holding the in-app location to return to after an
 *  involuntary re-authentication. Value is JSON `{ loc, exp }`. Exported so
 *  tests assert against a single source of truth rather than a copied string. */
export const RETURN_TO_KEY = 'auth.returnTo'
/** A stored return-to older than this is treated as stale and ignored. It was
 *  most likely left by a re-auth the user abandoned; without a bound it would
 *  survive in sessionStorage for the whole tab session and hijack a later,
 *  unrelated voluntary sign-in — sending the user to a page they didn't ask for. */
export const RETURN_TO_TTL_MS = 10 * 60 * 1000

export class AuthService {
	private userManager: UserManager
	private readonly logger = resolve(ILogger).scopeTo('AuthService')
	private readonly ea = resolve(IEventAggregator)
	private readyResolve?: () => void
	public readonly ready: Promise<void>
	/** Single in-flight refresh shared by boot restore, the resume hook, and the
	 *  reactive interceptors, so at most one `signinSilent()` runs at a time —
	 *  the antidote to Zitadel's refresh-token rotation race. */
	private refreshInFlight: Promise<User | null> | null = null
	/** Latch so concurrent unrecoverable 401s trigger the forced re-auth cleanup
	 *  and redirect exactly once (a double `signinRedirect()` would race PKCE
	 *  state). Reset naturally by the full-page redirect that unloads the app. */
	private reauthInFlight = false

	constructor() {
		this.logger.debug('Initializing AuthService')
		this.userManager = new UserManager(createSettings(resolve(IAppConfig)))

		// Create a promise that resolves when initial auth state is loaded
		this.ready = new Promise((resolve) => {
			this.readyResolve = resolve
		})

		this.userManager.events.addUserLoaded((user) => this.updateState(user))
		this.userManager.events.addUserUnloaded(() => this.updateState(null))
		this.restoreSession().then((user) => {
			this.updateState(user)
			// Resolve the ready promise only after the boot-time renewal attempt
			// (if any) has settled, so route guards observe a stable auth state.
			this.readyResolve?.()
		})

		// Resume-time refresh: the background renewal timer is disabled, so a token
		// that goes cold while the tab is idle would 401 the first foreground RPC.
		// Refresh proactively when the tab returns to the foreground, before the
		// user's next action — the same "refresh-if-expired-before-any-call" the
		// boot restore does (which is why a manual reload recovers the session).
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.onVisibilityChange)
		}
	}

	private readonly onVisibilityChange = (): void => {
		if (document.visibilityState !== 'visible') return
		void this.refreshOnResumeIfStale()
	}

	/** On foreground resume, refresh once if an authenticated user's token is
	 *  expired or within the skew window. No-op for guests or fresh tokens. */
	private async refreshOnResumeIfStale(): Promise<void> {
		// Never refresh while the OIDC callback is exchanging the auth code: at
		// that point `this.user` is not yet set, so we would fall back to the
		// still-stored expired user and fire `signinSilent()` with the OLD refresh
		// token, racing (and rotating out) the token the callback is establishing.
		if (
			typeof window !== 'undefined' &&
			window.location.pathname.startsWith('/auth/callback')
		) {
			return
		}
		const user = this.user ?? (await this.userManager.getUser())
		if (!user || !isExpiringWithinSkew(user)) return
		this.logger.info('Resume: token stale, refreshing before next RPC')
		await this.ensureFreshToken()
	}

	/**
	 * Single-flight silent refresh. Concurrent callers (boot restore, resume
	 * hook, reactive interceptors) share ONE `signinSilent()` call and all
	 * observe its result. Returns the refreshed user, or `null` if the refresh
	 * failed (e.g. the refresh token itself is expired/invalid). Never throws.
	 *
	 * When the provider rejects the refresh token itself (`invalid_grant`: it
	 * was revoked, expired, or already used — Zitadel rotates it on every use,
	 * so a refresh cut off by a reload leaves the stored one spent), the stored
	 * session is removed. Kept, it would be retried, and fail, on every start
	 * (two round trips before the app knows it is signed out). A network error
	 * keeps the session, so an offline start still has the stored tickets.
	 */
	public async ensureFreshToken(): Promise<User | null> {
		if (this.refreshInFlight) return this.refreshInFlight
		this.refreshInFlight = this.userManager
			.signinSilent()
			.catch(async (err: unknown) => {
				this.logger.info('Silent refresh failed', err)
				if (isInvalidGrant(err)) {
					this.logger.warn(
						'Refresh token rejected; removing the stored session',
					)
					await this.userManager.removeUser().catch(() => undefined)
					this.updateState(null)
				}
				return null
			})
			.finally(() => {
				this.refreshInFlight = null
			})
		return this.refreshInFlight
	}

	/**
	 * Cleanup for an INVOLUNTARY logout (unrecoverable `Unauthenticated`). Mirrors
	 * the voluntary {@link signOut} cleanup — publishes {@link SignedOut} so
	 * user-specific stores self-clear — and captures the in-app location to return
	 * to after re-authentication.
	 *
	 * Single-shot: returns `true` for the first caller (which SHOULD perform the
	 * entry-appropriate redirect — landing page for the consumer, sign-in for the
	 * consoles) and `false` for concurrent callers, so N simultaneous 401s do not
	 * fire N `signinRedirect()` calls (a double redirect races PKCE state). The
	 * latch resets naturally when the redirect unloads the app.
	 */
	public async prepareForcedReauth(returnTo?: string): Promise<boolean> {
		if (this.reauthInFlight) return false
		this.reauthInFlight = true
		this.logger.info('Forced re-auth: clearing session', { returnTo })
		if (returnTo) {
			try {
				sessionStorage.setItem(
					RETURN_TO_KEY,
					JSON.stringify({ loc: returnTo, exp: Date.now() + RETURN_TO_TTL_MS }),
				)
			} catch {
				// Storage unavailable — return-to is best-effort, not fatal.
			}
		}
		this.ea.publish(new SignedOut())
		await this.userManager.removeUser()
		return true
	}

	/**
	 * Release the single-shot forced-reauth latch. Called ONLY when the terminal
	 * hand-off after {@link prepareForcedReauth} failed to navigate away (e.g.
	 * `signinRedirect()` rejected, or a CSP blocked the location change), so the
	 * app is left signed-out but still mounted. Resetting the latch lets a later
	 * 401 retry the hand-off instead of silently skipping cleanup forever. The
	 * repeated `SignedOut`/`removeUser` on retry are idempotent no-ops.
	 */
	public releaseForcedReauthLatch(): void {
		this.reauthInFlight = false
	}

	/** Consume the stored return-to location (used by the auth callback to route
	 *  the user back to where they were). Always clears the entry. Returns null
	 *  when none is stored, the payload is malformed, or it is past its TTL (a
	 *  stale entry from an abandoned re-auth must not hijack this sign-in). */
	public takeReturnTo(): string | null {
		try {
			const raw = sessionStorage.getItem(RETURN_TO_KEY)
			if (!raw) return null
			sessionStorage.removeItem(RETURN_TO_KEY)
			const { loc, exp } = JSON.parse(raw) as { loc?: string; exp?: number }
			if (typeof loc !== 'string' || typeof exp !== 'number') return null
			if (Date.now() > exp) return null
			return loc
		} catch {
			return null
		}
	}

	private async restoreSession(): Promise<User | null> {
		const user = await this.userManager.getUser()
		if (user?.expired) {
			// Route boot restore through the shared single-flight so an early RPC
			// that 401s during boot joins this refresh instead of racing it.
			return await this.ensureFreshToken()
		}
		return user
	}

	public user: User | null = null

	/**
	 * Whether the signed-in user's email address is verified at the identity
	 * provider. It starts from the ID token's `email_verified` claim, which is
	 * fixed at sign-in, and {@link refreshEmailVerified} brings it up to date.
	 */
	public emailVerified = false

	public get isAuthenticated(): boolean {
		return !!this.user && !this.user.expired
	}

	private updateState(user: User | null): void {
		const claim = user?.profile.email_verified === true
		// A token refresh may keep the sign-in ID token, whose claim can be older
		// than a value read from userinfo; for the same identity keep the newer
		// "verified".
		const sameIdentity =
			!!user && !!this.user && user.profile.sub === this.user.profile.sub
		this.emailVerified = sameIdentity ? this.emailVerified || claim : claim
		this.user = user
		this.logger.info('Auth state updated', {
			isAuthenticated: this.isAuthenticated,
			user: user?.profile.preferred_username,
		})
	}

	/**
	 * Reads the identity provider's current `email_verified` from the OIDC
	 * userinfo endpoint with the current access token, so a verification made
	 * since sign-in, on this device or another, shows (OpenSpec change
	 * `fan-email-verification-in-app`, design D5). It is read-only: unlike
	 * `signinSilent()` it rotates no refresh token, so it cannot race
	 * {@link ensureFreshToken}. A failed read keeps the last known value.
	 */
	public async refreshEmailVerified(): Promise<void> {
		const token = this.user?.access_token
		if (!token) return
		try {
			const endpoint =
				await this.userManager.metadataService.getUserInfoEndpoint()
			const resp = await fetch(endpoint, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (!resp.ok) {
				this.logger.warn('Userinfo read failed', { status: resp.status })
				return
			}
			const claims = (await resp.json()) as { email_verified?: unknown }
			if (typeof claims.email_verified === 'boolean') {
				this.emailVerified = claims.email_verified
			}
		} catch (err) {
			this.logger.warn('Userinfo read failed', err)
		}
	}

	public async signIn(options?: SignInOptions): Promise<void> {
		this.logger.info('Starting sign-in flow')
		// A sign-in carries no flow marker (see signUp); only the return path.
		const returnTo = options?.returnTo
		const state: AuthFlowState | undefined = isInAppPath(returnTo)
			? { returnTo }
			: undefined
		// `prompt=login` forces Zitadel to re-authenticate instead of silently
		// reusing an existing SSO session. In dev this eases test-user switching;
		// callers also request it (forceLogin) to recover from a reused session
		// that resolved to the wrong org (organizer callback org enforcement).
		// Optional OIDC params are spread in a single pass so adding a new param
		// (e.g. acr_values) only requires one spread expression, not two branches.
		this.ea.publish(new AuthStarted('sign_in', options?.source))
		await this.userManager.signinRedirect({
			...(import.meta.env.DEV || options?.forceLogin
				? { prompt: 'login' }
				: {}),
			...(options?.loginHint ? { login_hint: options.loginHint } : {}),
			...(options?.uiLocales ? { ui_locales: options.uiLocales } : {}),
			...(state ? { state } : {}),
		})
	}

	public async signUp(options: SignUpOptions = {}): Promise<void> {
		this.logger.info('Starting sign-up flow', { origin: options.origin })
		// Zitadel's prompt=create defaults the hosted UI to the sign-up form, but
		// `prompt` is a request-only hint that is NOT echoed back to the callback.
		// Stamp the OIDC application `state` with a flow marker so the callback can
		// reliably tell sign-up from sign-in: oidc-client-ts persists it and returns
		// it intact on the resolved `User.state`. The auth-callback gates the
		// post-signup celebration on this marker, so a returning sign-in — which
		// carries no marker — never triggers the first-run dialog, regardless of
		// local cache state. `signIn()` deliberately omits the marker.
		const state: AuthFlowState = { flow: 'signup' }
		if (options.origin) state.origin = options.origin
		if (isInAppPath(options.returnTo)) state.returnTo = options.returnTo
		this.ea.publish(new AuthStarted('sign_up', options.source))
		await this.userManager.signinRedirect({
			prompt: 'create',
			state,
			...(options.uiLocales ? { ui_locales: options.uiLocales } : {}),
		})
	}

	public async signOut(): Promise<void> {
		this.logger.info('Starting sign-out flow')
		// Publish BEFORE the redirect so every store can self-clear (guest
		// follows, user-specific caches) while the app is still alive. This is
		// the single publish point for the two sign-out call sites
		// (settings-route, auth-status); each store subscribes and clears
		// idempotently, replacing the old guest-service clearAll() responsibility.
		this.ea.publish(new SignedOut())
		await this.userManager.signoutRedirect()
	}

	/**
	 * End the session on this device only, without the identity provider's
	 * end-session redirect: used after the account was deleted, when the
	 * identity no longer exists (OpenSpec change `delete-fan-accounts`, design
	 * D6). Publishes {@link SignedOut} first, like {@link signOut}, so every
	 * store clears the account's state.
	 */
	public async signOutLocally(): Promise<void> {
		this.logger.info('Ending the session on this device')
		this.ea.publish(new SignedOut())
		// removeUser fires `userUnloaded`, which clears `user`.
		await this.userManager.removeUser()
	}

	public async handleCallback(): Promise<User> {
		this.logger.info('Processing auth callback')
		try {
			// The account stored before this sign-in, if any (e.g. one whose
			// session lapsed without a sign-out). Read before signinCallback
			// replaces it.
			const previousSub = (await this.userManager.getUser())?.profile.sub
			const user = await this.userManager.signinCallback()
			if (!user) {
				throw new Error('signinCallback returned no user')
			}
			if (previousSub && previousSub !== user.profile.sub) {
				// Account switch: the previous account never signed out here, so its
				// client state is still on this device. Clear it the same way a
				// sign-out does before the new account's state loads, so nothing the
				// previous account left can be shown or sent for the new one.
				this.logger.info('Account switched; clearing previous account state')
				this.ea.publish(new SignedOut())
			}
			this.logger.info('Auth callback processed successfully', {
				user: user.profile.preferred_username,
			})
			this.updateState(user)
			return user
		} catch (err) {
			this.logger.error('Failed to process auth callback', err)
			throw err
		}
	}

	public getUserManager(): UserManager {
		return this.userManager
	}
}
