import type { Scanner } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/scanner_pb.js'
import { ILogger, resolve } from 'aurelia'
import { eventId } from '../model/concert-model'
import {
	eventsWithinWeek,
	groupHomeItems,
	type HomeGroup,
	type HomeItem,
	homeItems,
} from '../model/home-model'
import { IClock } from '../services/clock'
import {
	IPayoutAccountClient,
	type PayoutOnboardingStatus,
} from '../services/payout-account-client'
import { IScannerClient } from '../services/scanner-client'
import { type AuthoredSeries, ISeriesClient } from '../services/series-client'
import { IConsoleContext } from '../shell/console-context'
import { IPageProgress } from '../shell/page-progress'

type PartState = 'loading' | 'ready' | 'error'

/**
 * Home: what needs the member now, most urgent first, as one list grouped
 * by kind under subheaders; each item is one link to where it is resolved
 * (design D18). Reads the concerts, the payout account and the
 * scanners of the events starting within 7 days; a source that fails is
 * reported with 再試行 while the others still show their items.
 */
export class HomeRoute {
	private readonly series = resolve(ISeriesClient)
	private readonly payout = resolve(IPayoutAccountClient)
	private readonly scanners = resolve(IScannerClient)
	private readonly clock = resolve(IClock)
	public readonly context = resolve(IConsoleContext)
	private readonly progress = resolve(IPageProgress)
	private readonly logger = resolve(ILogger).scopeTo('HomeRoute')

	public concertsState: PartState = 'loading'
	public payoutState: PartState = 'loading'
	public items: HomeItem[] = []

	private concerts: AuthoredSeries[] = []
	private payoutStatus: PayoutOnboardingStatus | undefined
	private scannersByEvent = new Map<string, readonly Scanner[]>()
	private abort = new AbortController()

	public get isLoading(): boolean {
		return this.concertsState === 'loading' && this.payoutState === 'loading'
	}

	/** The items by kind, in the order of the list. */
	public get groups(): HomeGroup[] {
		return groupHomeItems(this.items)
	}

	public get allClear(): boolean {
		return (
			this.concertsState === 'ready' &&
			this.payoutState === 'ready' &&
			this.items.length === 0
		)
	}

	public attached(): void {
		void Promise.all([this.loadConcerts(), this.loadPayout()])
	}

	public detaching(): void {
		this.abort.abort()
	}

	public loadConcerts(): Promise<void> {
		return this.progress.track(this.readConcerts())
	}

	public loadPayout(): Promise<void> {
		return this.progress.track(this.readPayout())
	}

	private async readConcerts(): Promise<void> {
		this.concertsState = 'loading'
		try {
			this.concerts = await this.series.list(this.abort.signal)
			await this.loadScanners()
			this.concertsState = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Concerts unavailable', err)
			this.concerts = []
			this.concertsState = 'error'
		}
		this.refresh()
	}

	private async readPayout(): Promise<void> {
		this.payoutState = 'loading'
		try {
			this.payoutStatus = (await this.payout.get(this.abort.signal)).status
			this.payoutState = 'ready'
		} catch (err) {
			if (this.abort.signal.aborted) return
			this.logger.warn('Payout account unavailable', err)
			this.payoutStatus = undefined
			this.payoutState = 'error'
		}
		this.refresh()
	}

	/** Scanners of the events starting within the week, read in parallel. */
	private async loadScanners(): Promise<void> {
		const soon = eventsWithinWeek(this.concerts, this.clock.now())
		const results = await Promise.allSettled(
			soon.map(({ event }) =>
				this.scanners.listByEvent(eventId(event), this.abort.signal),
			),
		)
		this.scannersByEvent = new Map()
		results.forEach((result, i) => {
			if (result.status === 'fulfilled') {
				this.scannersByEvent.set(eventId(soon[i].event), result.value)
			}
		})
	}

	private refresh(): void {
		this.items = homeItems(
			{
				organizerId: this.context.organizerId,
				represented: new Set(
					this.context.artists.map((a) => a.id?.value ?? ''),
				),
				concerts: this.concerts,
				payoutStatus: this.payoutStatus,
				scanners: this.scannersByEvent,
			},
			this.clock.now(),
		)
	}
}
