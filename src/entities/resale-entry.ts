/**
 * Lifecycle state of a fan's resale entry.
 *
 * - `entered`   — waiting for a draw; the total is held on the card.
 * - `won`       — a draw allocated the tickets; the card is charged.
 * - `lost`      — no ticket was allocated, or the win could not be charged.
 * - `lapsed`    — the card authorization would expire before a draw could
 *                 charge it; nothing was charged.
 * - `withdrawn` — the fan withdrew it while it waited; nothing was charged.
 * - `unknown`   — a state this app does not know.
 *
 * @source proto/liverty_music/entity/v1/resale_entry.proto — ResaleEntryState
 */
export type ResaleEntryState =
	| 'entered'
	| 'won'
	| 'lost'
	| 'lapsed'
	| 'withdrawn'
	| 'unknown'

/**
 * A fan's application for official resale (公式リセール) tickets of one
 * TicketStock. The stock and the count are the entry's Order's.
 *
 * @source proto/liverty_music/entity/v1/resale_entry.proto — ResaleEntry
 * @source proto/liverty_music/entity/v1/order.proto — Order
 */
export interface ResaleEntry {
	readonly id: string
	readonly orderId: string
	/** The TicketStock the entry asks for; empty when its Order is unknown. */
	readonly ticketStockId: string
	/** How many tickets the entry asks for, allocated all together or not at all. */
	readonly ticketCount: number
	readonly state: ResaleEntryState
	readonly createTime: Date
	/** The next draw the entry takes part in; set only while Entered. */
	readonly nextDrawTime?: Date
}
