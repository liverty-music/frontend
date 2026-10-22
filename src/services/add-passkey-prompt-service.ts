import { DI, ILogger, observable, resolve } from 'aurelia'
import { IDocumentLocation } from '../adapter/browser/document-location'
import { ILocalStorage } from '../adapter/storage/local-storage'
import {
	savePasskeyReturn,
	takePasskeyReturn,
} from '../adapter/storage/passkey-return-storage'
import { IAppConfig } from '../config/app-config'
import { StorageKeys } from '../constants/storage-keys'
import { IAuthService } from './auth-service'
import { IPromptCoordinator } from './prompt-coordinator'

/** How long "Later, in Settings" keeps the prompt hidden on a device. */
export const ADD_PASSKEY_LATER_MS = 30 * 24 * 60 * 60 * 1000

export const IAddPasskeyPromptService =
	DI.createInterface<IAddPasskeyPromptService>(
		'IAddPasskeyPromptService',
		(x) => x.singleton(AddPasskeyPromptService),
	)

export interface IAddPasskeyPromptService extends AddPasskeyPromptService {}

/**
 * Creating a passkey on the device in hand, and the add-passkey prompt that
 * offers it after a Log In (OpenSpec change
 * `fan-passkey-recovery-and-management`, design D4 and D10).
 *
 * The app cannot tell whether the Log In used a passkey of this device (the
 * assertion runs in the hosted login, and its tokens carry no authenticator
 * attachment), so each device keeps its own record: set on sign-up and after
 * a passkey was created here. There is no "this device already has one"
 * choice: a fan cannot reliably tell whether a synced passkey lives on the
 * device, and creating one where one exists is harmless (the hosted login
 * excludes existing credentials). Storage that cannot be read counts as no
 * record, and "Later, in Settings" then is not remembered.
 */
export class AddPasskeyPromptService {
	private readonly storage = resolve(ILocalStorage)
	private readonly prompts = resolve(IPromptCoordinator)
	private readonly location = resolve(IDocumentLocation)
	private readonly config = resolve(IAppConfig)
	private readonly auth = resolve(IAuthService)
	private readonly logger = resolve(ILogger).scopeTo('AddPasskeyPrompt')

	/** Whether the prompt is shown. */
	@observable public open = false

	/** Whether this device holds the record. */
	public get hasDeviceRecord(): boolean {
		return this.read(StorageKeys.passkeyDeviceRecord) === '1'
	}

	/** Set this device's record: the prompt does not show here again. */
	public markDevice(): void {
		this.write(StorageKeys.passkeyDeviceRecord, '1')
	}

	/**
	 * Called by the auth callback after a Log In (never after a sign-up).
	 * Shows the prompt unless the device has the record, "Later, in Settings" was chosen
	 * here within 30 days, or another prompt already showed.
	 */
	public offerAfterLogIn(): void {
		if (this.hasDeviceRecord) return
		const later = Number(this.read(StorageKeys.passkeyPromptLater))
		if (later > 0 && Date.now() - later < ADD_PASSKEY_LATER_MS) return
		if (!this.prompts.canShowPrompt('add-passkey')) return
		this.prompts.markShown('add-passkey')
		this.open = true
	}

	/** "Later, in Settings", or a dismissal: hidden on this device for 30 days. */
	public later(): void {
		this.write(StorageKeys.passkeyPromptLater, String(Date.now()))
		this.open = false
	}

	/**
	 * Create a passkey on this device in the hosted login (design D4), then
	 * come back to `returnTo`. The hosted login session is fresh (a Log In or
	 * the passkey-management sign-in just happened), so it registers without
	 * asking who the fan is.
	 */
	public createOnThisDevice(returnTo: string): void {
		this.open = false
		savePasskeyReturn(returnTo)
		const base = this.config.zitadelIssuer.replace(/\/+$/, '')
		const params = new URLSearchParams({
			loginName: this.auth.user?.profile.email ?? '',
			organization: this.config.zitadelOrgId ?? '',
		})
		this.logger.info('Opening the hosted login to create a passkey')
		this.location.assign(`${base}/ui/v2/login/passkey/set?${params}`)
	}

	/**
	 * At the app root, where the hosted login lands after creating a passkey:
	 * read the place to return to and record that this device now holds a
	 * passkey. Returns null when no creation was in progress.
	 */
	public takeReturnAfterCreate(): string | null {
		const returnTo = takePasskeyReturn()
		if (returnTo) this.markDevice()
		return returnTo
	}

	private read(key: string): string | null {
		try {
			return this.storage.getItem(key)
		} catch {
			return null
		}
	}

	private write(key: string, value: string): void {
		try {
			this.storage.setItem(key, value)
		} catch {
			// Private mode: nothing is remembered (design D10).
		}
	}
}
