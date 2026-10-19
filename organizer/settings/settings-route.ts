import type { Artist } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/artist_pb.js'
import type { Organizer } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/organizer_pb.js'
import { ILogger, resolve } from 'aurelia'
import { businessDetailsComplete } from '../event/event-page'
import { IArtistClient } from '../services/artist-client'
import { IOrganizerClient } from '../services/organizer-client'
import {
	IPayoutAccountClient,
	type PayoutAccountView,
	PayoutOnboardingStatus,
} from '../services/payout-account-client'
import { IPageProgress } from '../shell/page-progress'
import type { Description } from '../ui/description-list/description-list'
import type { StatusTone } from '../ui/status-badge/status-badge'

type PartState = 'loading' | 'ready' | 'error'

const PAYOUT: Record<number, { tone: StatusTone; key: string }> = {
	[PayoutOnboardingStatus.PENDING]: {
		tone: 'warning',
		key: 'settings.payout.pending',
	},
	[PayoutOnboardingStatus.ACTIVE]: {
		tone: 'success',
		key: 'settings.payout.active',
	},
	[PayoutOnboardingStatus.RESTRICTED]: {
		tone: 'error',
		key: 'settings.payout.restricted',
	},
}

/**
 * Settings: who the Organizer is to Liverty Music and to fans, read only — its
 * name, its represented Artists, its business details, and its payout account
 * status. While the Organizer has no payout account or it is not active, the
 * page explains the hand-off to Stripe (what is entered there, and that Stripe
 * brings the member back to Home) before the action that asks for a fresh
 * onboarding page and opens it in this tab.
 */
export class SettingsRoute {
	private readonly organizers = resolve(IOrganizerClient)
	private readonly artists = resolve(IArtistClient)
	private readonly payout = resolve(IPayoutAccountClient)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')

	public organizerState: PartState = 'loading'
	public payoutState: PartState = 'loading'
	public organizer: Organizer | undefined
	public represented: Artist[] = []
	/** The payout account; null when the Organizer has none yet. */
	public account: PayoutAccountView | null = null
	/** True when the last request for Stripe's onboarding page failed. */
	public startFailed = false
	private abort = new AbortController()

	public attached(): void {
		void this.loadOrganizer()
		void this.loadPayout().then(() => {
			if (window.location.hash === '#payout') {
				document.getElementById('payout')?.scrollIntoView()
			}
		})
	}

	public detaching(): void {
		this.abort.abort()
	}

	public get name(): string {
		return this.organizer?.name?.value ?? ''
	}

	public get artistNames(): string[] {
		return this.represented.map((a) => a.name?.value ?? '').filter(Boolean)
	}

	/** The organization's name as a read-only description. */
	public get organization(): Description[] {
		return [{ termKey: 'settings.organizationName', value: this.name }]
	}

	/** The business details with their terms as catalog keys. */
	public get businessDetails(): Description[] {
		const o = this.organizer
		return [
			{
				termKey: 'settings.business.legalName',
				value: o?.legalName?.value ?? '',
			},
			{
				termKey: 'settings.business.representative',
				value: o?.representativeName?.value ?? '',
			},
			{
				termKey: 'settings.business.address',
				value: o?.businessAddress?.value ?? '',
			},
			{
				termKey: 'settings.business.phone',
				value: o?.businessPhoneNumber?.value ?? '',
			},
			{
				termKey: 'settings.business.email',
				value: o?.contactEmail?.value ?? '',
			},
		]
	}

	public get businessComplete(): boolean {
		return businessDetailsComplete(this.organizer)
	}

	public get payoutStatus(): { tone: StatusTone; key: string } {
		return (
			PAYOUT[this.account?.status ?? PayoutOnboardingStatus.PENDING] ??
			PAYOUT[PayoutOnboardingStatus.PENDING]
		)
	}

	public get payoutActive(): boolean {
		return this.account?.status === PayoutOnboardingStatus.ACTIVE
	}

	/** Set up when there is no account yet, continue setup otherwise. */
	public get onboardingKey(): string {
		return this.account ? 'settings.payout.continue' : 'settings.payout.start'
	}

	/**
	 * Asks for a fresh onboarding page and opens it in this tab. On failure the
	 * page stays and shows fixed copy, never the server's message.
	 */
	public async startOnboarding(): Promise<void> {
		this.startFailed = false
		try {
			const url = await this.payout.startOnboarding(this.abort.signal)
			window.location.assign(url)
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Onboarding page unavailable', err)
			this.startFailed = true
		}
	}

	/** Reads the organizer; the shell's progress indicator shows meanwhile. */
	public loadOrganizer(): Promise<void> {
		return this.progress.track(this.readOrganizer())
	}

	public loadPayout(): Promise<void> {
		return this.progress.track(this.readPayout())
	}

	private async readOrganizer(): Promise<void> {
		this.organizerState = 'loading'
		try {
			const [organizer, artists] = await Promise.all([
				this.organizers.get(this.abort.signal),
				this.artists.list(this.abort.signal),
			])
			this.organizer = organizer
			this.represented = artists
			this.organizerState = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Organizer unavailable', err)
			this.organizerState = 'error'
		}
	}

	private async readPayout(): Promise<void> {
		try {
			this.account = await this.payout.get(this.abort.signal)
			this.payoutState = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Payout account unavailable', err)
			this.payoutState = 'error'
		}
	}
}
