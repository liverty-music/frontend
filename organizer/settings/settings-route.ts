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
 * name and represented Artists, its business details, and its payout account
 * status with the link to finish onboarding. Returning to the tab re-reads
 * the payout status.
 */
export class SettingsRoute {
	private readonly organizers = resolve(IOrganizerClient)
	private readonly artists = resolve(IArtistClient)
	private readonly payout = resolve(IPayoutAccountClient)
	private readonly logger = resolve(ILogger).scopeTo('SettingsRoute')

	public organizerState: PartState = 'loading'
	public payoutState: PartState = 'loading'
	public organizer: Organizer | undefined
	public represented: Artist[] = []
	public account: PayoutAccountView | undefined
	private abort = new AbortController()

	private readonly onVisibility = (): void => {
		if (document.visibilityState === 'visible') void this.loadPayout()
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibility)
		void this.loadOrganizer()
		void this.loadPayout().then(() => {
			if (window.location.hash === '#payout') {
				document.getElementById('payout')?.scrollIntoView()
			}
		})
	}

	public detaching(): void {
		document.removeEventListener('visibilitychange', this.onVisibility)
		this.abort.abort()
	}

	public get name(): string {
		return this.organizer?.name?.value ?? ''
	}

	public get artistNames(): string[] {
		return this.represented.map((a) => a.name?.value ?? '').filter(Boolean)
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

	public async loadOrganizer(): Promise<void> {
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

	public async loadPayout(): Promise<void> {
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
