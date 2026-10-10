/**
 * A checkout's status as of the time it was read. A Held checkout whose hold
 * has lapsed is read as Expired.
 *
 * @source proto/liverty_music/entity/v1/reservation.proto — ReservationStatus
 */
export type ReservationStatus =
	| 'held'
	| 'committed'
	| 'completed'
	| 'expired'
	| 'released'
	| 'unknown'

/**
 * One fan's checkout on a TicketSale: the tickets it holds for 15 minutes and
 * what became of it.
 *
 * @source proto/liverty_music/entity/v1/reservation.proto — Reservation
 */
export interface Reservation {
	readonly id: string
	readonly ticketSaleId: string
	readonly ticketCount: number
	/** Total to pay in yen, 税込: the sale's price × the count. */
	readonly amount: number
	readonly status: ReservationStatus
	readonly holdExpireTime: Date
	/** Set when the checkout was ever committed. */
	readonly commitTime?: Date
	/** Set when the card was charged. */
	readonly captureTime?: Date
}
