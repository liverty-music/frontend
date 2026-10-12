/**
 * How a TicketSale sells: by lottery, or first come, first served.
 *
 * @source proto/liverty_music/entity/v1/ticket_sale.proto — TicketSaleMethod
 */
export type TicketSaleMethod = 'lottery' | 'firstCome'

/**
 * Which verification a fan needs before entering the sale or checking out.
 *
 * @source proto/liverty_music/entity/v1/ticket_sale.proto — VerificationRequirement
 */
export type VerificationRequirement = 'none' | 'verifiedAny' | 'jpkiOnly'

/**
 * Where a first-come TicketType stands at the time it was read.
 *
 * @source proto/liverty_music/entity/v1/ticket_type.proto — TicketTypeState
 */
export type TicketTypeState =
	| 'notYetOnSale'
	| 'onSale'
	| 'allHeld'
	| 'soldOut'
	| 'ended'

/**
 * What a sale offers for one event, as a fan sees it: never with a count,
 * only its price, limit and, for a first-come sale, its state and whether few
 * tickets are left.
 *
 * @source proto/liverty_music/entity/v1/ticket_type.proto — TicketType
 */
export interface TicketType {
	readonly id: string
	readonly eventId: string
	/** Price of one ticket in yen, 税込 (tax-inclusive). */
	readonly price: number
	/** Most tickets one account may hold for the event after this sale. */
	readonly perAccountLimit: number
	/** The first-come state; a lottery's TicketType reads `ended` here. */
	readonly state: TicketTypeState
	/** True when a first-come TicketType is on sale with few tickets left (残りわずか). */
	readonly lowStock: boolean
}

/**
 * One sale (受付) of an event, as the fan boundary returns it: its window and
 * its TicketType for that event.
 *
 * @source proto/liverty_music/entity/v1/ticket_sale.proto — TicketSale
 */
export interface TicketSale {
	readonly id: string
	readonly name: string
	readonly method: TicketSaleMethod
	readonly saleStartTime: Date
	readonly saleEndTime: Date
	readonly verificationRequirement: VerificationRequirement
	/** The sale's TicketType for the event it was read for. */
	readonly ticketType: TicketType
}

/** True while the sale's window is open at `now`. */
export function isWindowOpen(sale: TicketSale, now: Date): boolean {
	const t = now.getTime()
	return sale.saleStartTime.getTime() <= t && t < sale.saleEndTime.getTime()
}

/**
 * The sale an event page shows: the one whose window is open, otherwise the
 * next to open, otherwise the last that ended. Sales of one event never
 * overlap, so at most one is open. Null when the event has no sale.
 */
export function currentSale(
	sales: readonly TicketSale[],
	now: Date,
): TicketSale | null {
	const open = sales.find((s) => isWindowOpen(s, now))
	if (open) return open
	const t = now.getTime()
	const upcoming = sales
		.filter((s) => s.saleStartTime.getTime() > t)
		.sort((a, b) => a.saleStartTime.getTime() - b.saleStartTime.getTime())
	if (upcoming.length > 0) return upcoming[0]
	const ended = [...sales].sort(
		(a, b) => b.saleEndTime.getTime() - a.saleEndTime.getTime(),
	)
	return ended[0] ?? null
}

/** True while a fan can start a checkout on the first-come TicketType. */
export function isBuyable(ticketType: TicketType): boolean {
	return ticketType.state === 'onSale' || ticketType.state === 'allHeld'
}
