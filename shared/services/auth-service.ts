import { DI, IEventAggregator, ILogger, resolve } from 'aurelia'
import {
	type User,
	UserManager,
	type UserManagerSettings,
	WebStorageStateStore,
} from 'oidc-client-ts'
import { type AppConfig, IAppConfig } from '../config/app-config'
import { SignedOut } from './events/signed-out'

function createSettings(config: AppConfig): UserManagerSettings {
	return {
		authority: config.zitadelIssuer,
		client_id: config.zitadelClientId,
		redirect_uri: `${window.location.origin}/auth/callback`,
		post_logout_redirect_uri: `${window.location.origin}/`,
		response_type: 'code',
		scope: [
			'openid profile email offline_access',
			// Include org scope so Zitadel applies the Org-level login policy (passkey only)
			config.zitadelOrgId
				? `urn:zitadel:iam:org:id:${config.zitadelOrgId}`
				: '',
		]
			.filter(Boolean)
			.join(' '),
		// PKCE is standard/default for 'code' flow in newer oidc-client-ts versions
		loadUserInfo: true,
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
}

/**
 * Read the flow marker off a resolved OIDC user. Returns undefined when no
 * marker is present (a sign-in, or an older in-flight redirect started before
 * this signal existed) — callers MUST treat undefined as "not sign-up".
 */
export function resolveAuthFlow(user: User): AuthFlowState['flow'] {
	return (user.state as AuthFlowState | undefined)?.flow
}

export const IAuthService = DI.createInterface<IAuthService>(
	'IAuthService',
	(x) => x.singleton(AuthService),
)

export interface IAuthService extends AuthService {}

export class AuthService {
	private userManager: UserManager
	private readonly logger = resolve(ILogger).scopeTo('AuthService')
	private readonly ea = resolve(IEventAggregator)
	private readyResolve?: () => void
	public readonly ready: Promise<void>

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
	}

	private async restoreSession(): Promise<User | null> {
		const user = await this.userManager.getUser()
		if (user?.expired) {
			try {
				return await this.userManager.signinSilent()
			} catch (err) {
				this.logger.info('Silent session restore failed; signing out', err)
				return null
			}
		}
		return user
	}

	public user: User | null = null

	public get isAuthenticated(): boolean {
		return !!this.user && !this.user.expired
	}

	private updateState(user: User | null): void {
		this.user = user
		this.logger.info('Auth state updated', {
			isAuthenticated: this.isAuthenticated,
			user: user?.profile.preferred_username,
		})
	}

	public async signIn(options?: { loginHint?: string }): Promise<void> {
		this.logger.info('Starting sign-in flow')
		// In dev, force re-authentication to bypass Zitadel session cookies,
		// making it easy to switch between test users without clearing cookies.
		// Optional OIDC params are spread in a single pass so adding a new param
		// (e.g. acr_values) only requires one spread expression, not two branches.
		await this.userManager.signinRedirect({
			...(import.meta.env.DEV ? { prompt: 'login' } : {}),
			...(options?.loginHint ? { login_hint: options.loginHint } : {}),
		})
	}

	public async signUp(): Promise<void> {
		this.logger.info('Starting sign-up flow')
		// Zitadel's prompt=create defaults the hosted UI to the sign-up form, but
		// `prompt` is a request-only hint that is NOT echoed back to the callback.
		// Stamp the OIDC application `state` with a flow marker so the callback can
		// reliably tell sign-up from sign-in: oidc-client-ts persists it and returns
		// it intact on the resolved `User.state`. The auth-callback gates the
		// post-signup celebration on this marker, so a returning sign-in — which
		// carries no marker — never triggers the first-run dialog, regardless of
		// local cache state. `signIn()` deliberately omits the marker.
		await this.userManager.signinRedirect({
			prompt: 'create',
			state: { flow: 'signup' } satisfies AuthFlowState,
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

	public async handleCallback(): Promise<User> {
		this.logger.info('Processing auth callback')
		try {
			const user = await this.userManager.signinCallback()
			if (!user) {
				throw new Error('signinCallback returned no user')
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
