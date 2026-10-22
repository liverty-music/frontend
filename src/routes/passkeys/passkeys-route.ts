import { I18N } from '@aurelia/i18n'
import type { NavigationInstruction } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import {
	IPasskeyClient,
	type Passkey,
	PasskeyRequestError,
} from '../../adapter/zitadel/passkey-client'
import { IAddPasskeyPromptService } from '../../services/add-passkey-prompt-service'
import { IAuthService } from '../../services/auth-service'
import {
	IPasskeyAuthService,
	PASSKEY_MANAGEMENT_PATH,
} from '../../services/passkey-auth-service'
import { currentLanguage } from '../../util/change-locale'

/** Where the passkey list stands. */
export type PasskeyListState = 'loading' | 'ready' | 'error'

/**
 * Passkey management (`/settings/passkeys`, design D3-D5): lists the passkeys
 * of the fan's identity, adds one on the device in hand and removes others.
 *
 * It opens only with the passkey-management token, which the hosted login
 * issues for a sign-in within the last 5 minutes. Without one, canLoad sends
 * the fan to the hosted login, which returns through
 * `/auth/passkeys-callback`. Leaving the screen discards the token, so the
 * next opening asks the 5-minute rule again.
 */
export class PasskeysRoute {
	private readonly auth = resolve(IAuthService)
	private readonly passkeyAuth = resolve(IPasskeyAuthService)
	private readonly client = resolve(IPasskeyClient)
	private readonly addPasskey = resolve(IAddPasskeyPromptService)
	private readonly i18n = resolve(I18N)
	private readonly logger = resolve(ILogger).scopeTo('PasskeysRoute')

	public passkeys: Passkey[] = []
	public listState: PasskeyListState = 'loading'
	/** The passkey whose removal awaits confirmation; null when none. */
	public pendingRemoval: Passkey | null = null
	public removalFailed = false
	public removing = false

	/**
	 * The last passkey cannot be removed from the app: the identity provider
	 * allows it, so the guard lives here (design D5).
	 */
	public get canRemove(): boolean {
		return this.passkeys.length > 1
	}

	public get confirmOpen(): boolean {
		return this.pendingRemoval !== null
	}

	public async canLoad(): Promise<boolean | NavigationInstruction> {
		await this.auth.ready
		if (!this.auth.isAuthenticated) return '/settings'
		if (this.passkeyAuth.session) return true
		await this.reauthenticate()
		return false
	}

	public loading(): void {
		// Not awaited: the screen shows its loading state while the list loads.
		void this.load()
	}

	public unloading(): void {
		this.passkeyAuth.discard()
	}

	/** Read the passkey list; also the retry of a failed read. */
	public async load(): Promise<void> {
		this.listState = 'loading'
		try {
			this.passkeys = await this.client.list()
			this.listState = 'ready'
		} catch (err) {
			if (!(err instanceof PasskeyRequestError)) throw err
			this.logger.warn('Failed to list passkeys', { failure: err.failure })
			if (err.failure === 'unauthenticated') {
				await this.reauthenticate()
				return
			}
			this.listState = 'error'
		}
	}

	public askRemoval(passkey: Passkey): void {
		if (!this.canRemove) return
		this.removalFailed = false
		this.pendingRemoval = passkey
	}

	public cancelRemoval(): void {
		this.pendingRemoval = null
		this.removalFailed = false
	}

	/** Remove the confirmed passkey; also the retry of a failed removal. */
	public async confirmRemoval(): Promise<void> {
		const passkey = this.pendingRemoval
		if (!passkey || this.removing || !this.canRemove) return
		this.removing = true
		this.removalFailed = false
		try {
			await this.client.remove(passkey.id)
		} catch (err) {
			if (!(err instanceof PasskeyRequestError)) throw err
			this.logger.warn('Failed to remove a passkey', { failure: err.failure })
			if (err.failure === 'unauthenticated') {
				await this.reauthenticate()
				return
			}
			// The list stays as it was; the sheet offers to try again.
			this.removalFailed = true
			return
		} finally {
			this.removing = false
		}
		this.passkeys = this.passkeys.filter((p) => p.id !== passkey.id)
		this.pendingRemoval = null
	}

	/**
	 * Create a passkey on this device in the hosted login (design D4). The
	 * passkey-management sign-in has just refreshed the hosted login's session,
	 * so it registers without asking again; it then sends the fan to the app
	 * root, which reopens this screen from the stored marker.
	 */
	public addOnThisDevice(): void {
		this.addPasskey.createOnThisDevice(PASSKEY_MANAGEMENT_PATH)
	}

	private async reauthenticate(): Promise<void> {
		this.passkeyAuth.discard()
		await this.passkeyAuth.start({
			loginHint: this.auth.user?.profile.email,
			uiLocales: currentLanguage(this.i18n),
		})
	}
}
