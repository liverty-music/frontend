import { DI, ILogger, resolve } from 'aurelia'
import {
	ErrorResponse,
	InMemoryWebStorage,
	type User,
	UserManager,
	WebStorageStateStore,
} from 'oidc-client-ts'
import { orgScope, zitadelMetadata } from '../../shared/services/auth-service'
import {
	peekFreshSignInStart,
	saveFreshSignInStart,
	takeFreshSignInStart,
} from '../adapter/storage/fresh-sign-in-storage'
import { IAppConfig } from '../config/app-config'

/** In-app path of passkey management. */
export const PASSKEY_MANAGEMENT_PATH = '/settings/passkeys'

/** In-app path of the withdrawal screen. */
export const DELETE_ACCOUNT_PATH = '/settings/delete-account'

/**
 * Redirect URI of the fresh sign-in (registered on the app). It keeps its
 * passkey-era name because the redirect URI registered at the identity
 * provider is reused (OpenSpec change `delete-fan-accounts`, design D4).
 */
export const FRESH_SIGN_IN_CALLBACK_PATH = '/auth/passkeys-callback'

/**
 * Longest time since the fan's last sign-in, in seconds, after which the
 * hosted login asks for a passkey again before the screen opens.
 */
export const FRESH_SIGN_IN_MAX_AGE_SEC = 300

/**
 * Scope that adds the identity provider's own API to the token's audience,
 * so the token can call User v2 ListPasskeys / RemovePasskey on the fan's own
 * identity. Only this flow requests it; the main session keeps the product
 * project as its only audience.
 */
export const ZITADEL_API_AUDIENCE_SCOPE =
	'urn:zitadel:iam:org:project:id:zitadel:aud'

/** The screens that ask for a fresh sign-in, and where each one lives. */
export const FRESH_SIGN_IN_SCREENS = {
	passkeys: PASSKEY_MANAGEMENT_PATH,
	deleteAccount: DELETE_ACCOUNT_PATH,
} as const

/** A screen the fresh sign-in returns to. */
export type FreshSignInScreen = keyof typeof FRESH_SIGN_IN_SCREENS

/** The oidc-client-ts request state of a fresh sign-in. */
interface FreshSignInState {
	readonly returnTo: FreshSignInScreen
}

function isFreshSignInScreen(value: unknown): value is FreshSignInScreen {
	return (
		typeof value === 'string' &&
		Object.keys(FRESH_SIGN_IN_SCREENS).includes(value)
	)
}

/**
 * The screen a request state names. A state without one comes from a sign-in
 * started before the withdrawal screen existed, when passkey management was
 * the only screen that asked.
 */
function screenOf(state: unknown): FreshSignInScreen {
	return namedScreen(state) ?? 'passkeys'
}

function namedScreen(state: unknown): FreshSignInScreen | null {
	const returnTo = (state as Partial<FreshSignInState> | null | undefined)
		?.returnTo
	return isFreshSignInScreen(returnTo) ? returnTo : null
}

/** The signed-in identity and tokens of a fresh sign-in. */
export interface FreshSignInSession {
	readonly userId: string
	/** Access token with the identity provider's API audience (passkeys). */
	readonly accessToken: string
	/**
	 * ID token of the sign-in: the proof of a fresh sign-in that
	 * UserService.Delete takes. A credential: never log or store it.
	 */
	readonly idToken: string
	/** The screen the sign-in was started for. */
	readonly returnTo: FreshSignInScreen
}

/** Options of {@link FreshSignInService.start}. */
export interface FreshSignInOptions {
	/** The fan's email, so the hosted login does not ask who they are. */
	loginHint?: string
	/** Language the hosted login should show (OIDC `ui_locales`). */
	uiLocales?: string
}

/** A fresh sign-in that did not complete, with the screen it was for. */
export class FreshSignInError extends Error {
	public constructor(
		public readonly returnTo: FreshSignInScreen,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options)
		this.name = 'FreshSignInError'
	}
}

export const IFreshSignInService = DI.createInterface<IFreshSignInService>(
	'IFreshSignInService',
	(x) => x.singleton(FreshSignInService),
)

export interface IFreshSignInService extends FreshSignInService {}

/**
 * The short-lived, re-authenticated sign-in behind passkey management and the
 * withdrawal screen (OpenSpec changes `fan-passkey-recovery-and-management`
 * design D3, and `delete-fan-accounts` design D4).
 *
 * A second oidc-client-ts `UserManager`, separate from the main session's:
 * - it asks for `prompt=login`, so the hosted login always asks the fan to
 *   sign in again. `max_age=300` alone is not enough: Zitadel's login V2
 *   ignores it and answers with the existing session (zitadel/zitadel#12258),
 *   whose `auth_time` the backend then rejects for account deletion. `max_age`
 *   stays so the ID token carries `auth_time`;
 * - its token carries the identity provider's API audience, which the main
 *   token never does (passkey management needs it);
 * - the screen to return to travels in the request state, and the single
 *   callback route sends the fan there;
 * - the tokens live in memory only (`InMemoryWebStorage`): a reload drops
 *   them, and {@link discard} drops them when the fan leaves the screen. They
 *   are never refreshed (no `offline_access`).
 *
 * Only the redirect's PKCE state goes to sessionStorage (under its own prefix),
 * because it has to survive the round trip through the hosted login.
 */
export class FreshSignInService {
	private readonly logger = resolve(ILogger).scopeTo('FreshSignInService')
	private readonly userManager: UserManager
	private user: User | null = null

	constructor() {
		const config = resolve(IAppConfig)
		this.userManager = new UserManager({
			authority: config.zitadelIssuer,
			metadata: zitadelMetadata(config.zitadelIssuer),
			client_id: config.zitadelClientId,
			redirect_uri: `${window.location.origin}${FRESH_SIGN_IN_CALLBACK_PATH}`,
			response_type: 'code',
			scope: ['openid', ZITADEL_API_AUDIENCE_SCOPE, orgScope(config)]
				.filter(Boolean)
				.join(' '),
			max_age: FRESH_SIGN_IN_MAX_AGE_SEC,
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

	/** The open fresh sign-in for `screen`, or null when none is usable. */
	public sessionFor(screen: FreshSignInScreen): FreshSignInSession | null {
		const session = this.toSession(this.user)
		return session?.returnTo === screen ? session : null
	}

	/**
	 * Send the fan to the hosted login for a fresh sign-in. It returns to
	 * {@link FRESH_SIGN_IN_CALLBACK_PATH}, which opens `screen`.
	 */
	public async start(
		screen: FreshSignInScreen,
		options: FreshSignInOptions = {},
	): Promise<void> {
		this.logger.info('Starting a fresh sign-in', { returnTo: screen })
		saveFreshSignInStart(screen)
		const state: FreshSignInState = { returnTo: screen }
		await this.userManager.signinRedirect({
			max_age: FRESH_SIGN_IN_MAX_AGE_SEC,
			prompt: 'login',
			state,
			...(options.loginHint ? { login_hint: options.loginHint } : {}),
			...(options.uiLocales ? { ui_locales: options.uiLocales } : {}),
		})
	}

	/**
	 * Whether the fan is back on `screen` from a fresh sign-in started for it.
	 * Read once: it is cleared by the read. True with no
	 * {@link sessionFor session} means the sign-in was abandoned or failed.
	 */
	public takeReturn(screen: FreshSignInScreen): boolean {
		return takeFreshSignInStart() === screen
	}

	/**
	 * Complete the sign-in on the callback route and hold its tokens. Rejects
	 * with a {@link FreshSignInError} naming the screen it was started for.
	 */
	public async handleCallback(): Promise<FreshSignInSession> {
		let user: User | undefined
		try {
			user = await this.userManager.signinCallback()
		} catch (err) {
			// The identity provider's error carries the request state; any other
			// failure (e.g. the state was not found) falls back to the screen
			// that started the sign-in.
			const state = err instanceof ErrorResponse ? err.state : undefined
			throw new FreshSignInError(
				namedScreen(state) ??
					namedScreen({ returnTo: peekFreshSignInStart() }) ??
					'passkeys',
				'fresh sign-in did not complete',
				{ cause: err },
			)
		}
		const returnTo = screenOf(user?.state)
		if (!user) {
			throw new FreshSignInError(returnTo, 'signinCallback returned no user')
		}
		this.user = user
		const session = this.toSession(user)
		if (!session) {
			throw new FreshSignInError(returnTo, 'fresh sign-in already expired')
		}
		return session
	}

	/** Drop the tokens: the next opening asks the 5-minute rule again. */
	public discard(): void {
		this.user = null
		void this.userManager.removeUser().catch((err: unknown) => {
			this.logger.warn('Failed to clear the fresh sign-in', err)
		})
	}

	private toSession(user: User | null): FreshSignInSession | null {
		if (!user || user.expired) return null
		return {
			userId: user.profile.sub,
			accessToken: user.access_token,
			idToken: user.id_token ?? '',
			returnTo: screenOf(user.state),
		}
	}
}
