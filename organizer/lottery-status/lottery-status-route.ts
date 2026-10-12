import type { Params } from '@aurelia/router'
import { type Timestamp, timestampDate } from '@bufbuild/protobuf/wkt'
import { ILogger, resolve } from 'aurelia'
import { formatJstDateTime } from '../../shared/lib/reception/jst-format'
import { toOrganizerErrorMessage } from '../services/connect-error-copy'
import {
	type EventTicketSales,
	ITicketSaleClient,
	TicketSaleMethod,
} from '../services/ticket-sale-client'

/** Coarse lifecycle phase for the status fetch. */
type LoadPhase = 'loading' | 'ready' | 'error'

/** A flattened view of one lottery sale of the event and its tallies. */
export interface LotteryStatusView {
	readonly ticketSaleId: string
	readonly name: string
	/** True while the entry window is currently open. */
	readonly windowOpen: boolean
	/** Human window state, one of "Not yet open", "Open", or "Closed". */
	readonly windowLabel: string
	readonly saleStartTimeLabel: string
	readonly saleEndTimeLabel: string
	readonly quantity: number
	readonly perAccountLimit: number
	readonly price: number
	readonly drawCompleted: boolean
	readonly entryCount: number
	readonly ticketCount: number
	readonly wonEntryCount: number
	readonly wonTicketCount: number
	readonly lostEntryCount: number
}

const EMPTY = '—'

/** Formats a proto Timestamp value as Japan time, or `—`. */
function formatInstant(ts: Timestamp | undefined): string {
	if (!ts) return EMPTY
	return formatJstDateTime(timestampDate(ts))
}

/**
 * The event's lottery sales as status views: each Lottery sale's TicketType
 * for the event with its entry tallies. `now` is injected for tests.
 */
export function lotteryViewsOf(
	eventId: string,
	sales: EventTicketSales,
	now: number = Date.now(),
): LotteryStatusView[] {
	return sales.ticketSales.flatMap((sale) => {
		if (sale.method !== TicketSaleMethod.LOTTERY) return []
		const type = sale.ticketTypes.find((t) => t.eventId?.value === eventId)
		if (!type) return []
		const typeId = type.id?.value ?? ''
		const stats = sales.lotteryEntryStats.find(
			(s) => s.ticketTypeId?.value === typeId,
		)
		const open = sale.saleStartTime
			? timestampDate(sale.saleStartTime).getTime()
			: undefined
		const close = sale.saleEndTime
			? timestampDate(sale.saleEndTime).getTime()
			: undefined
		let windowLabel = EMPTY
		if (open !== undefined && close !== undefined) {
			if (now < open) windowLabel = 'Not yet open'
			else if (now < close) windowLabel = 'Open'
			else windowLabel = 'Closed'
		}
		return [
			{
				ticketSaleId: sale.id?.value ?? '',
				name: sale.name?.value ?? '',
				windowOpen: windowLabel === 'Open',
				windowLabel,
				saleStartTimeLabel: formatInstant(sale.saleStartTime),
				saleEndTimeLabel: formatInstant(sale.saleEndTime),
				quantity: type.quantity ?? 0,
				perAccountLimit: type.perAccountLimit,
				price: Number(type.price?.value ?? 0),
				drawCompleted: sale.drawTime !== undefined,
				entryCount: stats?.entryCount ?? 0,
				ticketCount: stats?.ticketCount ?? 0,
				wonEntryCount: stats?.wonEntryCount ?? 0,
				wonTicketCount: stats?.wonTicketCount ?? 0,
				lostEntryCount: stats?.lostEntryCount ?? 0,
			},
		]
	})
}

/**
 * The lottery status / draw-outcome screen of one event (`lottery/status/
 * :eventId`). Reads the event's sales with {@link ITicketSaleClient.listByEvent}
 * and renders, for each lottery sale, whether its window is open or closed,
 * whether the draw has run, and the entry tallies. Before the draw the outcome
 * tallies are suppressed (they are not yet meaningful).
 *
 * Loading, empty (no lottery sale), and error states are all handled; errors
 * are translated from `ConnectError` codes via {@link toOrganizerErrorMessage}.
 */
export class LotteryStatusRoute {
	public phase: LoadPhase = 'loading'
	public loadError = ''
	public eventId = ''
	public views: LotteryStatusView[] = []

	private abort: AbortController | null = null

	private readonly client = resolve(ITicketSaleClient)
	private readonly logger = resolve(ILogger).scopeTo('LotteryStatusRoute')

	public canLoad(params: Params): boolean {
		this.eventId = params.eventId ?? ''
		return true
	}

	public attached(): void {
		void this.load()
	}

	public detaching(): void {
		this.abort?.abort()
	}

	public get isEmpty(): boolean {
		return this.phase === 'ready' && this.views.length === 0
	}

	public async load(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'loading'
		this.loadError = ''
		try {
			const sales = await this.client.listByEvent(this.eventId, abort.signal)
			if (abort.signal.aborted) return
			this.views = lotteryViewsOf(this.eventId, sales)
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.loadError = toOrganizerErrorMessage(
				err,
				'Failed to load the lottery status.',
			)
			this.phase = 'error'
			this.logger.error('Failed to load lottery status', {
				eventId: this.eventId,
				err,
			})
		}
	}
}
