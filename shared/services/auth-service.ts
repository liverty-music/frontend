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
	}
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

	// Restore the session on cold start. oidc-client-ts issue #2012: when the app
	// boots with an already-expired access token, automaticSilentRenew drops the
	// renewal timer based on the access token alone and never consults the still-
	// valid refresh token, leaving the user unauthenticated. Work around it by
	// explicitly calling signinSilent() when the stored user is expired, so a
	// valid refresh token transparently restores the session.
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

	public async signIn(): Promise<void> {
		this.logger.info('Starting sign-in flow')
		// In dev, force re-authentication to bypass Zitadel session cookies,
		// making it easy to switch between test users without clearing cookies.
		await this.userManager.signinRedirect(
			import.meta.env.DEV ? { prompt: 'login' } : undefined,
		)
	}

	public async signUp(): Promise<void> {
		this.logger.info('Starting sign-up flow')
		// Zitadel supports prompt=create to default to sign-up form. No custom
		// `state` round-trip: the callback no longer keys behavior on the sign-up
		// FLOW. Guest-follow migration fires on every authenticated callback, and
		// the post-signup dialog keys on the backend new-account signal — neither
		// needs an isSignUp flag, so plumbing one through OIDC state would be dead.
		await this.userManager.signinRedirect({
			prompt: 'create',
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
