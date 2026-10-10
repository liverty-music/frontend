/**
 * Where a TicketSale stands at the time it was read.
 *
 * @source proto/liverty_music/entity/v1/ticket_sale.proto — TicketSaleState
 */
export type TicketSaleState =
	| 'notYetOnSale'
	| 'onSale'
	| 'allHeld'
	| 'soldOut'
	| 'ended'

/**
 * The platform's own first-come sale of one event's tickets, as a fan sees it:
 * never with a count, only its state and whether few tickets are left.
 *
 * @source proto/liverty_music/entity/v1/ticket_sale.proto — TicketSale
 */
export interface TicketSale {
	readonly id: string
	readonly eventId: string
	readonly saleStart: Date
	readonly saleEnd: Date
	/** Price of one ticket in yen, 税込 (tax-inclusive). */
	readonly price: number
	/** Most tickets one account may buy from the sale. */
	readonly perAccountLimit: number
	readonly state: TicketSaleState
	/** True when the sale is on sale with few tickets left (残りわずか). */
	readonly lowStock: boolean
}

/** True while a fan can start a checkout on the sale. */
export function isBuyable(sale: TicketSale): boolean {
	return sale.state === 'onSale' || sale.state === 'allHeld'
}
