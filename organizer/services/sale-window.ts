import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { TicketSale } from './ticket-sale-client'

/**
 * The first of an event's sales whose window overlaps `start`–`end`, or
 * undefined. Sales of one event never overlap; back-to-back windows (one ends
 * as the next starts) do not. `exceptSaleId` leaves out the sale being moved.
 */
export function findOverlappingSale(
	sales: readonly TicketSale[],
	start: Date,
	end: Date,
	exceptSaleId?: string,
): TicketSale | undefined {
	return sales.find((s) => {
		if (exceptSaleId && s.id?.value === exceptSaleId) return false
		if (!s.saleStartTime || !s.saleEndTime) return false
		const otherStart = timestampDate(s.saleStartTime).getTime()
		const otherEnd = timestampDate(s.saleEndTime).getTime()
		return start.getTime() < otherEnd && otherStart < end.getTime()
	})
}
