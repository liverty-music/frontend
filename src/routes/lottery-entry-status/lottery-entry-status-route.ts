import type { IRouteViewModel, Params } from '@aurelia/router'
import { ILogger, resolve } from 'aurelia'
import { ILotteryEntryRpcClient } from '../../adapter/rpc/client/lottery-entry-client'
import { ITicketSaleRpcClient } from '../../adapter/rpc/client/ticket-sale-client'
import type {
	LotteryEntry,
	LotteryEntryState,
} from '../../entities/lottery-entry'
import type { TicketStock } from '../../entities/ticket-sale'

/**
 * Discrete UI phases of the entry status view.
 *   - `loading` — the entries are being read.
 *   - `empty`   — the fan made no entry in this sale for this event.
 *   - `error`   — the read failed; a reload is offered.
 *   - `loaded`  — `entry` drives the render.
 */
export type EntryStatusViewStep = 'loading' | 'empty' | 'error' | 'loaded'

/**
 * The visual bucket the view renders: Entered shows the waiting state; Won
 * and Lost show the result prominently.
 */
export type ResultKind = 'entered' | 'won' | 'lost'

/**
 * The fan's lottery entry status in one sale for one event
 * (`/events/:id/lottery/:saleId/:stockId/entry`). Reads the fan's entries in
 * the sale with LotteryEntryService.ListByTicketType and the event's stocks
 * with TicketSaleService.ListByEvent, and shows the entry for one of this
 * event's stocks (at most one per sale and event, made at Confirm): its seat
 * type, count and state (抽選待ち / 当選 / 落選). The entry may be for another
 * seat type than the one in the address, when the fan came from a refused
 * second entry. An entry cannot be withdrawn once made.
 */
export class LotteryEntryStatusRoute implements IRouteViewModel {
	public step: EntryStatusViewStep = 'loading'
	/** An i18n key for the current error or note, or ''. */
	public messageKey = ''
	public entry: LotteryEntry | null = null
	/** The stock the entry asks for, with its seat type. */
	public stock: TicketStock | null = null

	private eventId = ''
	private saleId = ''
	private readonly logger = resolve(ILogger).scopeTo('LotteryEntryStatusRoute')
	private readonly entryClient = resolve(ILotteryEntryRpcClient)
	private readonly saleClient = resolve(ITicketSaleRpcClient)
	private abortController: AbortController | null = null

	public loading(params: Params): void {
		this.eventId = params.id ?? ''
		this.saleId = params.saleId ?? ''
		// Never hold the view swap on data: start the read and return.
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	public async load(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		const { signal } = this.abortController
		this.step = 'loading'
		this.messageKey = ''
		try {
			const [entries, tickets] = await Promise.all([
				this.entryClient.listBySale(this.saleId, signal),
				this.saleClient.listByEvent(this.eventId, signal),
			])
			if (signal.aborted) return
			// A tour sale names other dates too: only this event's entry.
			const stocks = new Map(tickets.stocks.map((s) => [s.id, s]))
			this.entry = entries.find((e) => stocks.has(e.ticketStockId)) ?? null
			this.stock = this.entry
				? (stocks.get(this.entry.ticketStockId) ?? null)
				: null
			this.step = this.entry ? 'loaded' : 'empty'
		} catch (err) {
			if (signal.aborted) return
			this.logger.error('Lottery entry read failed', { error: err })
			this.messageKey = 'lotteryEntryStatus.error'
			this.step = 'error'
		}
	}

	// ── Derived state ─────────────────────────────────────────────────────────

	private get state(): LotteryEntryState {
		return this.entry?.state ?? 'unknown'
	}

	/** The visual bucket the template renders for the current state. */
	public get resultKind(): ResultKind {
		switch (this.state) {
			case 'won':
			case 'lost':
				return this.state
			default:
				return 'entered'
		}
	}

	/** i18n key of the state's label. */
	public get stateLabelKey(): string {
		const known = ['entered', 'won', 'lost']
		return `lotteryEntryStatus.state.${known.includes(this.state) ? this.state : 'unknown'}`
	}
}
