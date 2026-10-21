/**
 * Where a fan's official resale (公式リセール) listing stands when read. A
 * listing still listed at its deadline is read as `expired`.
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
	/** Face value in yen, 税込. */
	readonly price: number
	/** The resale fee in yen: 10% of the price, rounded down. */
	readonly fee: number
	/** What the fan is refunded when it sells: the price minus the fee. */
	readonly refundAmount: number
	readonly status: ResaleListingStatus
	readonly createTime: Date
	/** When it can no longer be bought or withdrawn: when admission opens. */
	readonly deadlineTime: Date
	/** Set when another fan bought it. */
	readonly soldTime?: Date
	/** Set once the fan was refunded. */
	readonly refundTime?: Date
}

/** How long before the start time official resale closes (admission opens). */
export const RESALE_DEADLINE_LEAD_MS = 3 * 60 * 60 * 1000

/** The resale deadline of an event starting at `start`: 3 hours earlier. */
export function resaleDeadline(start: Date): Date {
	return new Date(start.getTime() - RESALE_DEADLINE_LEAD_MS)
}

/** The resale fee rate stated on the listing screen. */
export const RESALE_FEE_PERCENT = 10
