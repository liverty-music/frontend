import { I18N } from '@aurelia/i18n'
import type { NavigationInstruction } from '@aurelia/router'
import { ConnectError } from '@connectrpc/connect'
import { IEventAggregator, ILogger, resolve } from 'aurelia'
import { Snack } from '../../../shared/ui/snack-bar/snack'
import { IDocumentLocation } from '../../adapter/browser/document-location'
import { IPasskeyRpcClient } from '../../adapter/rpc/client/passkey-client'
import {
	savePasskeyIdsBeforeAdd,
	savePasskeyReturn,
	takePasskeyIdsBeforeAdd,
	takePasskeyReturn,
} from '../../adapter/storage/passkey-return-storage'
import {
	IPasskeyClient,
	type Passkey,
	PasskeyRequestError,
} from '../../adapter/zitadel/passkey-client'
import { IAppConfig } from '../../config/app-config'
import type { PasskeyRecord } from '../../entities/passkey'
import { IAuthService } from '../../services/auth-service'
import {
	IPasskeyAuthService,
	PASSKEY_MANAGEMENT_PATH,
} from '../../services/passkey-auth-service'
import { currentLanguage } from '../../util/change-locale'

/**
 * A passkey as listed: the identity provider's passkey joined by id with the
 * platform's record of it, when there is one (design D7).
 */
export interface ListedPasskey extends Passkey {
	/** The passkey provider, from the record. */
	readonly providerName?: string
	/** The day it was added (Japan time, `YYYY-MM-DD`), from the record. */
	readonly addedDate?: string
	/** That day, written for the fan's language. */
	readonly addedLabel?: string
}

/** Passkey dates are the day in Japan, where the product runs. */
const DATE_TIME_ZONE = 'Asia/Tokyo'

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
	private readonly records = resolve(IPasskeyRpcClient)
	private readonly location = resolve(IDocumentLocation)
	private readonly config = resolve(IAppConfig)
	private readonly i18n = resolve(I18N)
	private readonly ea = resolve(IEventAggregator)
	private readonly logger = resolve(ILogger).scopeTo('PasskeysRoute')

	public passkeys: ListedPasskey[] = []
	public listState: PasskeyListState = 'loading'
	/** The passkey whose removal awaits confirmation; null when none. */
	public pendingRemoval: ListedPasskey | null = null
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

	public attached(): void {
		// A browser back from the hosted login may restore this page from the
		// bfcache: no route hook runs then, so re-list on `pageshow`.
		window.addEventListener('pageshow', this.onPageShow)
	}

	public detaching(): void {
		window.removeEventListener('pageshow', this.onPageShow)
	}

	public unloading(): void {
		this.passkeyAuth.discard()
	}

	private readonly onPageShow = (event: PageTransitionEvent): void => {
		if (event.persisted) void this.load()
	}

	/** Read the passkey list; also the retry of a failed read. */
	public async load(): Promise<void> {
		this.listState = 'loading'
		try {
			const [passkeys, records] = await Promise.all([
				this.client.list(),
				this.loadRecords(),
			])
			this.passkeys = this.join(passkeys, records)
			this.listState = 'ready'
			this.compareWithBeforeAdd()
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

	/**
	 * After an add attempt, compare the list with the ids saved before leaving
	 * and say once, in a snack, whether a passkey was added. A refused creation (the
	 * device's passkey manager already holds one) leaves the list unchanged.
	 */
	private compareWithBeforeAdd(): void {
		const before = takePasskeyIdsBeforeAdd()
		if (!before) return
		// A browser back skips the root route; drop its marker so it cannot
		// redirect a later visit.
		takePasskeyReturn()
		const known = new Set(before)
		const added = this.passkeys.some((p) => !known.has(p.id))
		// A snack, so the outcome is not missed above the list.
		this.ea.publish(
			new Snack(
				this.i18n.tr(
					added ? 'passkeys.addOutcome.added' : 'passkeys.addOutcome.notAdded',
				),
				'info',
			),
		)
	}

	/**
	 * The platform's records. They only add detail, so a failure leaves the
	 * identity provider's list shown with names only.
	 */
	private async loadRecords(): Promise<PasskeyRecord[]> {
		try {
			return await this.records.list()
		} catch (err) {
			if (!(err instanceof ConnectError)) throw err
			this.logger.warn('Failed to read passkey records', { code: err.code })
			return []
		}
	}

	private join(passkeys: Passkey[], records: PasskeyRecord[]): ListedPasskey[] {
		const byId = new Map(records.map((r) => [r.id, r]))
		const locale = this.i18n.getLocale()
		return passkeys.map((passkey) => {
			const record = byId.get(passkey.id)
			if (!record) return passkey
			const created = record.createTime
			return {
				...passkey,
				...(record.providerName ? { providerName: record.providerName } : {}),
				...(created
					? {
							// en-CA writes the ISO calendar date.
							addedDate: new Intl.DateTimeFormat('en-CA', {
								timeZone: DATE_TIME_ZONE,
							}).format(created),
							addedLabel: new Intl.DateTimeFormat(locale, {
								dateStyle: 'medium',
								timeZone: DATE_TIME_ZONE,
							}).format(created),
						}
					: {}),
			}
		})
	}

	public askRemoval(passkey: ListedPasskey): void {
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
		savePasskeyIdsBeforeAdd(this.passkeys.map((p) => p.id))
		savePasskeyReturn(PASSKEY_MANAGEMENT_PATH)
		const base = this.config.zitadelIssuer.replace(/\/+$/, '')
		const params = new URLSearchParams({
			loginName: this.auth.user?.profile.email ?? '',
			organization: this.config.zitadelOrgId ?? '',
		})
		this.location.assign(`${base}/ui/v2/login/passkey/set?${params}`)
	}

	private async reauthenticate(): Promise<void> {
		this.passkeyAuth.discard()
		await this.passkeyAuth.start({
			loginHint: this.auth.user?.profile.email,
			uiLocales: currentLanguage(this.i18n),
		})
	}
}
