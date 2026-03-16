import { DI, ILogger, resolve } from 'aurelia'
import {
	type User,
	UserManager,
	type UserManagerSettings,
	WebStorageStateStore,
} from 'oidc-client-ts'

const settings: UserManagerSettings = {
	authority: import.meta.env.VITE_ZITADEL_ISSUER,
	client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
	redirect_uri: `${window.location.origin}/auth/callback`,
	post_logout_redirect_uri: `${window.location.origin}/`,
	response_type: 'code',
	scope: [
		'openid profile email offline_access',
		// Include org scope so Zitadel applies the Org-level login policy (passkey only)
		import.meta.env.VITE_ZITADEL_ORG_ID
			? `urn:zitadel:iam:org:id:${import.meta.env.VITE_ZITADEL_ORG_ID}`
			: '',
	]
		.filter(Boolean)
		.join(' '),
	// PKCE is standard/default for 'code' flow in newer oidc-client-ts versions
	loadUserInfo: true,
	// Use localStorage instead of sessionStorage for better compatibility with Playwright storageState
	userStore: new WebStorageStateStore({ store: window.localStorage }),
	// Disable session monitor in dev: Zitadel's check_session_iframe returns
	// frame-ancestors 'none', causing oidc-client-ts to fire userUnloaded
	// repeatedly (~10s) which re-bootstraps the entire Aurelia app.
	monitorSession: !import.meta.env.DEV,
}

export const IAuthService = DI.createInterface<IAuthService>(
	'IAuthService',
	(x) => x.singleton(AuthService),
)

export interface IAuthService extends AuthService {}

export class AuthService {
	private userManager: UserManager
	private readonly logger = resolve(ILogger).scopeTo('AuthService')
	private readyResolve?: () => void
	public readonly ready: Promise<void>

	constructor() {
		this.logger.debug('Initializing AuthService')
		this.userManager = new UserManager(settings)

		// Create a promise that resolves when initial auth state is loaded
		this.ready = new Promise((resolve) => {
			this.readyResolve = resolve
		})

		this.userManager.events.addUserLoaded((user) => this.updateState(user))
		this.userManager.events.addUserUnloaded(() => this.updateState(null))
		this.userManager.getUser().then((user) => {
			this.updateState(user)
			// Resolve the ready promise after initial user state is loaded
			this.readyResolve?.()
		})
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
		// Zitadel supports prompt=create to default to sign-up form
		// Onboarding vs login detection is handled via onboardingStep in localStorage
		await this.userManager.signinRedirect({
			prompt: 'create',
		})
	}

	public async signOut(): Promise<void> {
		this.logger.info('Starting sign-out flow')
		await this.userManager.signoutRedirect()
	}

	public async handleCallback(): Promise<User> {
		this.logger.info('Processing auth callback')
		try {
			const user = await this.userManager.signinCallback()
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
