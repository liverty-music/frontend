/**
 * Lifecycle state of a fan's lottery entry.
 *
 * - `entered`   — entered, awaiting the draw (card authorized). An entry is
 *                 made Entered at Confirm and cannot be withdrawn.
 * - `won`       — drawn; the card authorization was captured (charged).
 * - `lost`      — not drawn; the card authorization was released.
 * - `unknown`   — a state this app does not know.
 *
 * @source proto/liverty_music/entity/v1/lottery_entry.proto — LotteryEntryState
 */
export type LotteryEntryState = 'entered' | 'won' | 'lost' | 'unknown'

/**
 * A fan's entry to a lottery sale for one TicketStock. The stock and the count
 * are the entry's Order's, created with the entry.
 *
 * @source proto/liverty_music/entity/v1/lottery_entry.proto — LotteryEntry
 * @source proto/liverty_music/entity/v1/order.proto — Order
 */
export interface LotteryEntry {
	readonly id: string
	readonly orderId: string
	readonly ticketSaleId: string
	/** The TicketStock the entry asks for; empty when its Order is unknown. */
	readonly ticketStockId: string
	/** How many tickets the entry asks for (the companion group's size). */
	readonly ticketCount: number
	readonly state: LotteryEntryState
}
