import {
	instantToWall,
	wallToInstant,
} from '../../shared/lib/zoned-time/zoned-time'

/**
 * Where a fan's official resale (公式リセール) listing stands when read. A
 * listing still listed at its close time is read as `expired`.
 *
 * @source proto/liverty_music/entity/v1/resale_listing.proto — ResaleListingStatus
 */
export type ResaleListingStatus =
	| 'listed'
	| 'sold'
	| 'withdrawn'
	| 'cancelled'
	| 'expired'
	| 'unknown'

/**
 * A fan's offer of one of their tickets for official resale at face value.
 * Only the fan's own side: never the checkout holding it or the fan who
 * bought it.
 *
 * @source proto/liverty_music/entity/v1/resale_listing.proto — ResaleListing
 */
export interface ResaleListing {
	readonly id: string
	readonly ticketId: string
	/** The TicketStock the listed ticket was issued from. */
	readonly ticketStockId: string
	/** Face value in yen, 税込. */
	readonly price: number
	/** The resale fee in yen: 10% of the price, rounded down. */
	readonly fee: number
	/** What the fan is refunded when it sells: the price minus the fee. */
	readonly refundAmount: number
	readonly status: ResaleListingStatus
	readonly createTime: Date
	/**
	 * When the listing closes: it can no longer be allocated or withdrawn
	 * after this instant (the event's resale deadline).
	 */
	readonly closeTime: Date
	/** Set when another fan bought it. */
	readonly sellTime?: Date
	/** Set once the fan was refunded. */
	readonly refundTime?: Date
}

/** The hour, at the event's Venue, of every resale draw. */
export const RESALE_DRAW_HOUR = 12

/** The last draw runs at the latest this long before the start time. */
export const RESALE_DEADLINE_LEAD_MS = 3 * 60 * 60 * 1000

/**
 * The resale deadline of an event starting at `start` at a Venue in `zone`:
 * its last draw, at 12:00 at the Venue on the event's day or 3 hours before
 * the start time, whichever is earlier. Listing and applying close then.
 */
export function resaleDeadline(start: Date, zone: string): Date {
	const day = instantToWall(start, zone)
	const noon =
		wallToInstant({ ...day, hour: RESALE_DRAW_HOUR, minute: 0 }, zone) ?? start
	const lead = new Date(start.getTime() - RESALE_DEADLINE_LEAD_MS)
	return lead < noon ? lead : noon
}

/** The resale fee rate stated on the listing screen. */
export const RESALE_FEE_PERCENT = 10
