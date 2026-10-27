import { DI, ILogger, resolve } from 'aurelia'
import {
	InMemoryWebStorage,
	type User,
	UserManager,
	WebStorageStateStore,
} from 'oidc-client-ts'
import { orgScope, zitadelMetadata } from '../../shared/services/auth-service'
import { IAppConfig } from '../config/app-config'

/** In-app path of passkey management. */
export const PASSKEY_MANAGEMENT_PATH = '/settings/passkeys'

/** Redirect URI of the passkey-management sign-in (registered on the app). */
export const PASSKEYS_CALLBACK_PATH = '/auth/passkeys-callback'

/**
 * Longest time since the fan's last sign-in, in seconds, after which the
 * hosted login asks for a passkey again before passkey management opens.
 */
export const PASSKEY_MANAGEMENT_MAX_AGE_SEC = 300

/**
 * Scope that adds the identity provider's own API to the token's audience,
 * so the token can call User v2 ListPasskeys / RemovePasskey on the fan's own
 * identity. Only this flow requests it; the main session keeps the product
 * project as its only audience.
 */
export const ZITADEL_API_AUDIENCE_SCOPE =
	'urn:zitadel:iam:org:project:id:zitadel:aud'

/** The signed-in identity and token passkey management acts with. */
export interface PasskeySession {
	readonly userId: string
	readonly accessToken: string
}

/** Options of {@link PasskeyAuthService.start}. */
export interface PasskeySignInOptions {
	/** The fan's email, so the hosted login does not ask who they are. */
	loginHint?: string
	/** Language the hosted login should show (OIDC `ui_locales`). */
	uiLocales?: string
}

export const IPasskeyAuthService = DI.createInterface<IPasskeyAuthService>(
	'IPasskeyAuthService',
	(x) => x.singleton(PasskeyAuthService),
)

export interface IPasskeyAuthService extends PasskeyAuthService {}

/**
 * The short-lived, re-authenticated token behind passkey management
 * (OpenSpec change `fan-passkey-recovery-and-management`, design D3).
 *
 * A second oidc-client-ts `UserManager`, separate from the main session's:
 * - it asks for `max_age=300`, so the hosted login asks for a passkey when the
 *   fan's last sign-in is older than 5 minutes and answers silently otherwise;
 * - its token carries the identity provider's API audience, which the main
 *   token never does;
 * - the token lives in memory only (`InMemoryWebStorage`): a reload drops it,
 *   and {@link discard} drops it when the fan leaves passkey management. It is
 *   never refreshed (no `offline_access`).
 *
 * Only the redirect's PKCE state goes to sessionStorage (under its own prefix),
 * because it has to survive the round trip through the hosted login.
 */
export class PasskeyAuthService {
	private readonly logger = resolve(ILogger).scopeTo('PasskeyAuthService')
	private readonly userManager: UserManager
	private user: User | null = null

	constructor() {
		const config = resolve(IAppConfig)
		this.userManager = new UserManager({
			authority: config.zitadelIssuer,
			metadata: zitadelMetadata(config.zitadelIssuer),
			client_id: config.zitadelClientId,
			redirect_uri: `${window.location.origin}${PASSKEYS_CALLBACK_PATH}`,
			response_type: 'code',
			scope: ['openid', ZITADEL_API_AUDIENCE_SCOPE, orgScope(config)]
				.filter(Boolean)
				.join(' '),
			max_age: PASSKEY_MANAGEMENT_MAX_AGE_SEC,
			loadUserInfo: false,
			userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
			stateStore: new WebStorageStateStore({
				prefix: 'oidc.passkeys.',
				store: window.sessionStorage,
			}),
			monitorSession: false,
			automaticSilentRenew: false,
		})
	}

	/** The open passkey-management session, or null when none is usable. */
	public get session(): PasskeySession | null {
		const user = this.user
		if (!user || user.expired) return null
		return { userId: user.profile.sub, accessToken: user.access_token }
	}

	/**
	 * Send the fan to the hosted login for passkey management. It returns to
	 * {@link PASSKEYS_CALLBACK_PATH}.
	 */
	public async start(options: PasskeySignInOptions = {}): Promise<void> {
		this.logger.info('Starting the passkey-management sign-in')
		await this.userManager.signinRedirect({
			max_age: PASSKEY_MANAGEMENT_MAX_AGE_SEC,
			...(options.loginHint ? { login_hint: options.loginHint } : {}),
			...(options.uiLocales ? { ui_locales: options.uiLocales } : {}),
		})
	}

	/** Complete the sign-in on the callback route and hold its token. */
	public async handleCallback(): Promise<PasskeySession> {
		const user = await this.userManager.signinCallback()
		if (!user) throw new Error('signinCallback returned no user')
		this.user = user
		const session = this.session
		if (!session) throw new Error('passkey-management token already expired')
		return session
	}

	/** Drop the token: the next opening asks the 5-minute rule again. */
	public discard(): void {
		this.user = null
		void this.userManager.removeUser().catch((err: unknown) => {
			this.logger.warn('Failed to clear the passkey-management token', err)
		})
	}
}
