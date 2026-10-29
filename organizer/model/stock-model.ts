import type { SeatType } from '@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/seat_type_pb.js'
import {
	type EventTicketStocks,
	TicketStockState,
} from '../services/ticket-stock-client'
import type { StatusTone } from '../ui/status-badge/status-badge'

export type StockState = 'available' | 'allHeld' | 'soldOut'

/** One TicketStock of an event as the console shows it (席種と枚数). */
export interface StockView {
	id: string
	seatTypeId: string
	/** The seat type's name, e.g. S席. */
	name: string
	/** The seat type's whole-yen, tax-inclusive price. */
	price: number
	quantity: number
	sold: number
	held: number
	/** Tickets neither sold nor held now. */
	remaining: number
	state: StockState
	tone: StatusTone
	/** Catalog key of the state's label (販売可, 残りは購入手続き中, 完売). */
	stateKey: string
	/**
	 * Whether 削除 is offered: nothing is sold or held. The read carries no
	 * count of the stock's Orders, so a stock whose only Orders are Pending
	 * lottery entries is offered and the server refuses the delete.
	 */
	deletable: boolean
}

const STATES: Record<number, { state: StockState; tone: StatusTone }> = {
	[TicketStockState.AVAILABLE]: { state: 'available', tone: 'success' },
	[TicketStockState.ALL_HELD]: { state: 'allHeld', tone: 'info' },
	[TicketStockState.SOLD_OUT]: { state: 'soldOut', tone: 'neutral' },
}

/** The seat type's price in whole yen. */
export function priceOf(seatType: SeatType | undefined): number {
	return Number(seatType?.price?.value ?? 0)
}

/** The event's stocks, in the order read, each with its seat type and counts. */
export function stockViewsOf(read: EventTicketStocks): StockView[] {
	return read.ticketStocks.map((stock) => {
		const seatTypeId = stock.seatTypeId?.value ?? ''
		const seatType = read.seatTypes.find((t) => t.id?.value === seatTypeId)
		const quantity = stock.quantity ?? 0
		const sold = stock.soldCount ?? 0
		const held = stock.heldCount ?? 0
		const { state, tone } =
			STATES[stock.state] ?? STATES[TicketStockState.AVAILABLE]
		return {
			id: stock.id?.value ?? '',
			seatTypeId,
			name: seatType?.name?.value ?? '',
			price: priceOf(seatType),
			quantity,
			sold,
			held,
			remaining: Math.max(0, quantity - sold - held),
			state,
			tone,
			stateKey: `stock.state.${state}`,
			deletable: sold + held === 0,
		}
	})
}
