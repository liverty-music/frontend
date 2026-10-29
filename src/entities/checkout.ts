/**
 * A checkout's status as of the time it was read. A Held checkout whose hold
 * has lapsed is read as Expired.
 *
 * @source proto/liverty_music/entity/v1/checkout.proto — CheckoutStatus
 */
export type CheckoutStatus =
	| 'held'
	| 'committed'
	| 'completed'
	| 'expired'
	| 'released'
	| 'unknown'

/**
 * One fan's first-come checkout of a TicketStock: the tickets it holds for 15
 * minutes and what became of it. The stock, the count and the amount are the
 * Pending Order's, created with the checkout.
 *
 * @source proto/liverty_music/entity/v1/checkout.proto — Checkout
 * @source proto/liverty_music/entity/v1/order.proto — Order
 */
export interface Checkout {
	readonly id: string
	readonly orderId: string
	readonly ticketSaleId: string
	/** The TicketStock the Order buys from. */
	readonly ticketStockId: string
	readonly ticketCount: number
	/** Total to pay in yen, 税込: the seat type's price × the count. */
	readonly amount: number
	readonly status: CheckoutStatus
	readonly holdExpireTime: Date
	/** Set when the checkout was ever committed. */
	readonly commitTime?: Date
	/** Set when the card was charged. */
	readonly captureTime?: Date
}
