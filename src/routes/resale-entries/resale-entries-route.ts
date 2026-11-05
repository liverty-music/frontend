import type { IRouteViewModel } from '@aurelia/router'
import { Code, ConnectError } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { IConcertRpcClient } from '../../adapter/rpc/client/concert-client'
import { IResaleEntryRpcClient } from '../../adapter/rpc/client/resale-entry-client'
import type { ResaleEntry } from '../../entities/resale-entry'
import type { TicketStock } from '../../entities/ticket-sale'
import { IUserStore } from '../../services/user-store'
import {
	type EventPageEvent,
	eventFromConcert,
	formatEventDate,
	formatSaleStart,
} from '../event/event-page'

/**
 * - `loading`: the entries are read.
 * - `ready`: the entries are shown (possibly none).
 * - `error`: the read failed; a retry is offered.
 */
export type ResaleEntriesState = 'loading' | 'ready' | 'error'

/** One entry as the list shows it. */
export interface ResaleEntryRow {
	readonly entry: ResaleEntry
	readonly stock: TicketStock | null
	readonly event: EventPageEvent | null
}

/**
 * The fan's official resale entries (`/resale-entries`), newest first, each
 * with its concert, seat type, count and state. An entry waiting for a draw
 * can be withdrawn; a lapsed or withdrawn one offers to apply again while the
 * stock's resale is open. The resale emails link here.
 */
export class ResaleEntriesRoute implements IRouteViewModel {
	private readonly logger = resolve(ILogger).scopeTo('ResaleEntriesRoute')
	private readonly entryClient = resolve(IResaleEntryRpcClient)
	private readonly concertClient = resolve(IConcertRpcClient)
	private readonly userStore = resolve(IUserStore)

	public state: ResaleEntriesState = 'loading'
	public rows: ResaleEntryRow[] = []
	/** The entry whose withdrawal the fan is asked to confirm, or empty. */
	public confirmingId = ''
	/** The entry being withdrawn, or empty. */
	public withdrawingId = ''
	/** A message about one entry: its id and an i18n key. */
	public message: { readonly entryId: string; readonly key: string } | null =
		null

	private abortController: AbortController | null = null

	public loading(): void {
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	private get signal(): AbortSignal | undefined {
		return this.abortController?.signal
	}

	/** Read the entries, then each entry's concert. */
	public async load(): Promise<void> {
		this.abortController?.abort()
		this.abortController = new AbortController()
		const { signal } = this.abortController
		this.state = 'loading'
		try {
			await this.read(signal)
			if (!signal.aborted) this.state = 'ready'
		} catch (err) {
			if (signal.aborted) return
			this.logger.warn('Resale entries read failed', { error: err })
			this.state = 'error'
		}
	}

	private async read(signal: AbortSignal): Promise<void> {
		const { entries, stocks } = await this.entryClient.list(signal)
		const eventIds = [
			...new Set([...stocks.values()].map((s) => s.eventId).filter(Boolean)),
		]
		const events = new Map<string, EventPageEvent>()
		await Promise.all(
			eventIds.map(async (id) => {
				try {
					const event = eventFromConcert(
						await this.concertClient.get(id, signal),
					)
					if (event) events.set(id, event)
				} catch (err) {
					// The row stands without its concert.
					if (!signal.aborted) {
						this.logger.warn('Concert read failed', { eventId: id, error: err })
					}
				}
			}),
		)
		if (signal.aborted) return
		this.rows = entries.map((entry) => {
			const stock = stocks.get(entry.ticketStockId) ?? null
			return {
				entry,
				stock,
				event: stock ? (events.get(stock.eventId) ?? null) : null,
			}
		})
	}

	// ── Derived view ──────────────────────────────────────────────────────────

	private get lang(): string {
		return this.userStore.currentLanguage
	}

	public dateLabel(row: ResaleEntryRow): string {
		return row.event ? formatEventDate(row.event, this.lang) : ''
	}

	public nextDrawLabel(row: ResaleEntryRow): string {
		const next = row.entry.nextDrawTime
		return next ? formatSaleStart(next, this.lang) : ''
	}

	/** True when a lapsed or withdrawn entry may be made again. */
	public canApplyAgain(row: ResaleEntryRow): boolean {
		const { state } = row.entry
		return (
			(state === 'lapsed' || state === 'withdrawn') &&
			(row.stock?.resaleOpen ?? false)
		)
	}

	public applyUrl(row: ResaleEntryRow): string {
		return row.stock
			? `/events/${row.stock.eventId}/resale/${row.stock.id}`
			: '/resale-entries'
	}

	// ── Actions ───────────────────────────────────────────────────────────────

	/** Ask the fan to confirm withdrawing a waiting entry. */
	public askWithdraw(row: ResaleEntryRow): void {
		if (row.entry.state !== 'entered' || this.withdrawingId) return
		this.message = null
		this.confirmingId = row.entry.id
	}

	public cancelWithdraw(): void {
		this.confirmingId = ''
	}

	/**
	 * Withdraw the entry (ResaleEntryService.Withdraw). When a draw decided it
	 * first, say so and show the entry as it is now.
	 */
	public async withdraw(row: ResaleEntryRow): Promise<void> {
		const id = row.entry.id
		if (this.confirmingId !== id || this.withdrawingId) return
		this.withdrawingId = id
		this.message = null
		try {
			const withdrawn = await this.entryClient.withdraw(id, this.signal)
			this.rows = this.rows.map((r) =>
				r.entry.id === id
					? {
							...r,
							// Withdraw returns the entry alone; the count and stock stay.
							entry: {
								...withdrawn,
								ticketStockId: r.entry.ticketStockId,
								ticketCount: r.entry.ticketCount,
							},
						}
					: r,
			)
		} catch (err) {
			if (this.signal?.aborted) return
			const decided = ConnectError.from(err).code === Code.FailedPrecondition
			this.logger.warn('Withdraw failed', { resaleEntryId: id, error: err })
			this.message = {
				entryId: id,
				key: decided
					? 'resaleEntries.withdraw.decided'
					: 'resaleEntries.withdraw.failed',
			}
			if (decided) {
				// Show the state the draw gave the entry.
				try {
					if (this.signal) await this.read(this.signal)
				} catch (readErr) {
					this.logger.warn('Resale entries re-read failed', {
						error: readErr,
					})
				}
			}
		} finally {
			this.withdrawingId = ''
			this.confirmingId = ''
		}
	}
}
