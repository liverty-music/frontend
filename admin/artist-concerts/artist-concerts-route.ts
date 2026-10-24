import type { Params } from '@aurelia/router'
import { OrderStatus } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/order_pb.js'
import { PublishState } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/series_pb.js'
import { Code } from '@connectrpc/connect'
import { ILogger, resolve } from 'aurelia'
import { EMPTY, formatDateValue } from '../lib/local-date'
import { IArtistClient } from '../services/artist-client'
import {
	IConcertClient,
	type ResolvedConcert,
} from '../services/concert-client'
import { toUserMessage } from '../services/error-message'
import { IOrderClient, type Order } from '../services/order-client'

/** Coarse lifecycle phase for the initial list fetch. */
type LoadPhase = 'loading' | 'ready' | 'not-found' | 'error'

/** The state a row shows: the Concert's publish state, or Discovered. */
export type ConcertState = 'Published' | 'Cancelled' | 'Discovered'

/** Copy for a Delete refused with FailedPrecondition, whatever the reason. */
export const DELETE_BLOCKED =
	'This concert cannot be deleted while it has a paid order, a settlement that is not reversed, or a purchase in progress.'

const UNTITLED_SERIES = 'Untitled series'

/**
 * One Concert of the Artist with the per-row state the screen needs. An
 * Organizer's Concert also carries its Paid Orders, read with
 * OrderService.ListByEvent.
 */
export interface ConcertRow {
	readonly eventId: string
	readonly date: string
	readonly seriesTitle: string
	readonly venueName: string
	readonly state: ConcertState
	/** Whether the Concert belongs to an Organizer's Series. */
	readonly firstParty: boolean
	/** Ids of the Orders still Paid, in pay order. */
	paidOrderIds: string[]
	/** Total of the Paid Orders in yen. */
	paidTotal: number
	ordersError: string
	/** Progress of a running Refund all, e.g. `Refunding 1 of 2…`. */
	progress: string
	actionError: string
	busy: boolean
}

function stateOf(concert: ResolvedConcert): ConcertState {
	switch (concert.event.publishState) {
		case PublishState.CANCELLED:
			return 'Cancelled'
		case PublishState.PUBLISHED:
			return 'Published'
		default:
			return 'Discovered'
	}
}

function toRow(concert: ResolvedConcert): ConcertRow {
	return {
		eventId: concert.event.id?.value ?? '',
		date: formatDateValue(concert.event.localDate?.value),
		seriesTitle: concert.series?.title?.value ?? UNTITLED_SERIES,
		venueName: concert.event.venue?.name?.value ?? EMPTY,
		state: stateOf(concert),
		firstParty: concert.series?.organizerId !== undefined,
		paidOrderIds: [],
		paidTotal: 0,
		ordersError: '',
		progress: '',
		actionError: '',
		busy: false,
	}
}

function applyOrders(row: ConcertRow, orders: Order[]): void {
	const paid = orders.filter((o) => o.status === OrderStatus.PAID)
	row.paidOrderIds = paid.map((o) => o.id?.value ?? '')
	row.paidTotal = paid.reduce((sum, o) => sum + Number(o.amount), 0)
}

/** Formats a whole yen amount as `8,000 yen`. */
export function formatYen(amount: number): string {
	return `${amount.toLocaleString('en-US')} yen`
}

/**
 * Artist concerts screen, opened from an Organizer's roster at
 * `artists/:artistId/concerts` with the Artist's id only. It reads the Artist
 * (ArtistService.Get) and every Concert the Artist performs in
 * (ConcertService.ListByArtist), with each Organizer Concert's Paid Orders
 * (OrderService.ListByEvent).
 *
 * A CANCELLED Concert with a Paid Order offers Refund all: after a modal
 * confirmation it refunds each Paid Order for 中止 one at a time, re-reads the
 * Orders after every call, and stops at the first failure; running it again
 * refunds only the Orders still Paid. Every Concert offers Delete after a
 * modal confirmation. Both dialogs focus Cancel first, and Escape closes them
 * without a call.
 */
export class ArtistConcertsRoute {
	public artistId = ''
	public artistName = ''
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public rows: ConcertRow[] = []

	/** Refund-all dialog state. */
	public pendingRefund: ConcertRow | null = null
	public refundDialog?: HTMLDialogElement
	public refundCancelButton?: HTMLButtonElement

	/** Delete dialog state. */
	public pendingDelete: ConcertRow | null = null
	public deleting = false
	public deleteDialog?: HTMLDialogElement
	public deleteCancelButton?: HTMLButtonElement

	private readonly artistClient = resolve(IArtistClient)
	private readonly concertClient = resolve(IConcertClient)
	private readonly orderClient = resolve(IOrderClient)
	private readonly logger = resolve(ILogger).scopeTo('ArtistConcertsRoute')
	/** Aborts the reads of a load that a newer load or leaving supersedes. */
	private abortController: AbortController | null = null

	/**
	 * Loads for the route's Artist. It runs on every activation, so a reused
	 * instance opened for another Artist starts from a clean state.
	 */
	public loading(params: Params): void {
		this.artistId = params.artistId ?? ''
		void this.load()
	}

	public detaching(): void {
		this.abortController?.abort()
	}

	public async load(): Promise<void> {
		this.abortController?.abort()
		const abort = new AbortController()
		this.abortController = abort
		const { signal } = abort
		this.phase = 'loading'
		this.loadError = ''
		this.artistName = ''
		this.rows = []
		// The name is kept when the Artist is read even if its Concerts are not.
		const artist = this.artistClient.get(this.artistId, signal).then((a) => {
			if (!signal.aborted && a) this.artistName = a.name?.value ?? ''
			return a
		})
		try {
			const [found, concerts] = await Promise.all([
				artist,
				this.concertClient.listByArtist(this.artistId, signal),
			])
			if (signal.aborted) return
			if (!found) {
				this.phase = 'not-found'
				return
			}
			this.rows = concerts.map(toRow)
			this.phase = 'ready'
			await Promise.all(
				this.rows
					.filter((r) => r.firstParty)
					.map((r) => this.loadOrders(r, signal)),
			)
		} catch (err) {
			if (signal.aborted) return
			this.loadError = toUserMessage(err, 'Failed to load the concerts.')
			this.phase = 'error'
			this.logger.error('Failed to load artist concerts', {
				artistId: this.artistId,
				err,
			})
		}
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.rows.length === 0
	}

	/** Formats a total; a closed dialog has no pending row and shows 0 yen. */
	public formatYen(amount: number | undefined): string {
		return formatYen(amount ?? 0)
	}

	public canRefundAll(row: ConcertRow): boolean {
		return row.state === 'Cancelled' && row.paidOrderIds.length > 0
	}

	private async loadOrders(
		row: ConcertRow,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			applyOrders(row, await this.orderClient.listByEvent(row.eventId, signal))
			row.ordersError = ''
		} catch (err) {
			if (signal?.aborted) return
			row.ordersError = toUserMessage(err, 'Failed to load the orders.')
			this.logger.error('Failed to load event orders', {
				eventId: row.eventId,
				err,
			})
		}
	}

	// --- Refund all ---------------------------------------------------------

	/** Opens the refund confirmation for a row; refunds nothing. */
	public requestRefundAll(row: ConcertRow): void {
		if (row.busy || !this.canRefundAll(row)) return
		this.pendingRefund = row
		row.actionError = ''
		this.openDialog(this.refundDialog, this.refundCancelButton)
	}

	public cancelRefundAll(): void {
		this.closeDialog(this.refundDialog)
		this.pendingRefund = null
	}

	/** Runs on every close of the refund dialog, Escape included. */
	public onRefundDialogClose(): void {
		this.pendingRefund = null
	}

	public async confirmRefundAll(): Promise<void> {
		const row = this.pendingRefund
		if (!row || row.busy) return
		this.closeDialog(this.refundDialog)
		this.pendingRefund = null

		const orderIds = [...row.paidOrderIds]
		const total = orderIds.length
		let done = 0
		row.busy = true
		row.actionError = ''
		try {
			for (const orderId of orderIds) {
				row.progress = `Refunding ${done + 1} of ${total}…`
				try {
					await this.orderClient.refundCancellation(orderId)
				} catch (err) {
					row.actionError = `Refunded ${done} of ${total} orders. Try again to refund the rest.`
					this.logger.error('Refund failed', { orderId, err })
					return
				} finally {
					await this.loadOrders(row)
				}
				done++
			}
		} finally {
			row.progress = ''
			row.busy = false
		}
	}

	// --- Delete -------------------------------------------------------------

	/** Opens the delete confirmation for a row; deletes nothing. */
	public requestDelete(row: ConcertRow): void {
		if (row.busy || this.deleting) return
		this.pendingDelete = row
		row.actionError = ''
		this.openDialog(this.deleteDialog, this.deleteCancelButton)
	}

	public cancelDelete(): void {
		this.closeDialog(this.deleteDialog)
		this.pendingDelete = null
	}

	/** Runs on every close of the delete dialog, Escape included. */
	public onDeleteDialogClose(): void {
		if (!this.deleting) this.pendingDelete = null
	}

	public async confirmDelete(): Promise<void> {
		const row = this.pendingDelete
		if (!row || this.deleting) return
		this.deleting = true
		row.busy = true
		try {
			await this.concertClient.delete(row.eventId)
			const idx = this.rows.indexOf(row)
			if (idx !== -1) this.rows.splice(idx, 1)
		} catch (err) {
			row.actionError = toUserMessage(err, 'Failed to delete the concert.', {
				[Code.FailedPrecondition]: DELETE_BLOCKED,
			})
			this.logger.error('Delete concert failed', { eventId: row.eventId, err })
		} finally {
			row.busy = false
			this.deleting = false
			this.closeDialog(this.deleteDialog)
			this.pendingDelete = null
		}
	}

	private openDialog(
		dialog: HTMLDialogElement | undefined,
		cancel: HTMLButtonElement | undefined,
	): void {
		// Guarded: jsdom does not implement showModal.
		try {
			dialog?.showModal()
		} catch {
			/* non-interactive environment: VM state still drives the flow */
		}
		// The actions are permanent, so the least destructive control takes
		// focus (WAI-ARIA APG dialog pattern).
		cancel?.focus()
	}

	private closeDialog(dialog: HTMLDialogElement | undefined): void {
		try {
			dialog?.close()
		} catch {
			/* non-interactive environment */
		}
	}
}
