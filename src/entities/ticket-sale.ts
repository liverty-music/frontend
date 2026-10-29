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
 * Where a TicketStock stands at the time it was read. `unknown` is a state
 * this app does not know; such a stock is shown but not sold.
 *
 * @source proto/liverty_music/entity/v1/ticket_stock.proto — TicketStockState
 */
export type TicketStockState = 'available' | 'allHeld' | 'soldOut' | 'unknown'

/**
 * One seat type (席種) of one event, as a fan sees it: its seat type's name
 * and price, its state and whether its resale is open, never a count. Every
 * sale of the event sells from the same stock.
 *
 * @source proto/liverty_music/entity/v1/ticket_stock.proto — TicketStock
 * @source proto/liverty_music/entity/v1/seat_type.proto — SeatType
 */
export interface TicketStock {
	readonly id: string
	readonly eventId: string
	readonly seatTypeId: string
	/** The seat type's name, e.g. "S席". */
	readonly seatTypeName: string
	/** Price of one ticket in yen, 税込 (tax-inclusive). */
	readonly price: number
	readonly state: TicketStockState
	/** True when the stock is Available with few tickets left (残りわずか). */
	readonly lowStock: boolean
	/**
	 * True when official resale (公式リセール) of the stock is open: it sold
	 * out and the resale deadline has not passed.
	 */
	readonly resaleOpen: boolean
}

/**
 * One sale (受付) of an event, as the fan boundary returns it: its window and
 * method. It sells every TicketStock of the events it names.
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
	/** The events the sale sells; a tour presale names several dates. */
	readonly eventIds: readonly string[]
}

/**
 * Everything the fan boundary returns for one event's tickets
 * (TicketSaleService.ListByEvent): its sales ordered by start time, its
 * TicketStocks shared by every sale, and its per-account limit.
 */
export interface EventTicketSales {
	readonly sales: readonly TicketSale[]
	readonly stocks: readonly TicketStock[]
	/**
	 * Most tickets one account may hold for the event across every sale,
	 * seat type and resale; null when the event has no sale.
	 */
	readonly perAccountLimit: number | null
}

/** An event with no sale and no stock. */
export const NO_TICKET_SALES: EventTicketSales = {
	sales: [],
	stocks: [],
	perAccountLimit: null,
}

/** True while the sale's window is open at `now`. */
export function isWindowOpen(sale: TicketSale, now: Date): boolean {
	const t = now.getTime()
	return sale.saleStartTime.getTime() <= t && t < sale.saleEndTime.getTime()
}

/** True once the sale's window has closed at `now`. */
export function hasEnded(sale: TicketSale, now: Date): boolean {
	return sale.saleEndTime.getTime() <= now.getTime()
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

/** True while a fan can start a checkout on the stock: it is Available. */
export function isBuyable(stock: TicketStock): boolean {
	return stock.state === 'available'
}

/** The counts a fan may pick: 1 to the per-account limit (none without one). */
export function countOptions(perAccountLimit: number | null): number[] {
	return Array.from({ length: perAccountLimit ?? 0 }, (_, i) => i + 1)
}
