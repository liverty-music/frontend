import { DI, ILogger, resolve } from 'aurelia'
import {
	type User,
	UserManager,
	type UserManagerSettings,
} from 'oidc-client-ts'

const settings: UserManagerSettings = {
	authority: import.meta.env.VITE_ZITADEL_ISSUER,
	client_id: import.meta.env.VITE_ZITADEL_CLIENT_ID,
	redirect_uri: `${window.location.origin}/auth/callback`,
	post_logout_redirect_uri: window.location.origin,
	response_type: 'code',
	scope: 'openid profile email offline_access', // offline_access for refresh tokens
	// PKCE is standard/default for 'code' flow in newer oidc-client-ts versions
	loadUserInfo: true,
}

export const IAuthService = DI.createInterface<IAuthService>(
	'IAuthService',
	(x) => x.singleton(AuthService),
)

export interface IAuthService extends AuthService {}

export class AuthService {
	private userManager: UserManager
	private readonly logger = resolve(ILogger).scopeTo('AuthService')

	constructor() {
		this.logger.debug('Initializing AuthService')
		this.userManager = new UserManager(settings)
		this.userManager.events.addUserLoaded((user) => this.updateState(user))
		this.userManager.events.addUserUnloaded(() => this.updateState(null))
		this.userManager.getUser().then((user) => this.updateState(user))
	}

	public user: User | null = null

	public get isAuthenticated(): boolean {
		return !!this.user && !this.user.expired
	}

	private updateState(user: User | null): void {
		this.logger.info('Auth state updated', {
			isAuthenticated: this.isAuthenticated,
			user: user?.profile.preferred_username,
		})
		this.user = user
	}

	public async signIn(): Promise<void> {
		this.logger.info('Starting sign-in flow')
		await this.userManager.signinRedirect()
	}

	public async register(): Promise<void> {
		this.logger.info('Starting registration flow')
		// Zitadel supports prompt=create to default to registration form
		await this.userManager.signinRedirect({ prompt: 'create' })
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
