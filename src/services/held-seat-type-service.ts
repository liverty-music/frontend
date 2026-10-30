import { DI, ILogger, resolve } from 'aurelia'
import { ICheckoutRpcClient } from '../adapter/rpc/client/checkout-client'
import { ILotteryEntryRpcClient } from '../adapter/rpc/client/lottery-entry-client'
import { IOrderRpcClient } from '../adapter/rpc/client/order-client'
import { loadCheckoutId } from '../adapter/storage/checkout-storage'
import type { EventTicketSales, TicketStock } from '../entities/ticket-sale'
import { IAuthService } from './auth-service'
import { IPurchasedTicketStore } from './purchased-ticket-store'

export const IHeldSeatTypeService = DI.createInterface<IHeldSeatTypeService>(
	'IHeldSeatTypeService',
	(x) => x.singleton(HeldSeatTypeService),
)

export interface IHeldSeatTypeService extends HeldSeatTypeService {}

/** What the fan holds or applied for at an event. */
export interface HeldTickets {
	/** The stock of the one seat type the fan holds or applied for. */
	readonly stock: TicketStock
	/**
	 * The tickets they hold or applied for: Issued tickets, Entered entries
	 * and the checkout held on this device. A Won entry counts through its
	 * tickets once they are issued.
	 */
	readonly count: number
}

/** The stock ids and ticket counts one source found. */
interface Found {
	readonly stockIds: readonly string[]
	readonly count: number
}

const NOTHING: Found = { stockIds: [], count: 0 }

/**
 * Finds the seat type the signed-in fan already holds or applied for at an
 * event. One account holds tickets of only one seat type per event, across
 * every sale (OpenSpec `stories/win-tickets-in-a-lottery` "One seat type per
 * account and event").
 *
 * No RPC returns it directly, so it is read from what the fan owns:
 * - the Orders of their Issued tickets for the event (OrderService.Get, read
 *   from the tickets IPurchasedTicketStore loaded);
 * - their Entered or Won entries in the event's lottery sales
 *   (LotteryEntryService.ListByTicketSale, which returns each entry's Order);
 * - the checkout they hold for the event on this device (CheckoutService.Get).
 *
 * A failed read is logged and leaves that source out: the server refuses a
 * second seat type at Start and AuthorizeCard anyway, so the answer only
 * narrows what the screen offers.
 */
export class HeldSeatTypeService {
	private readonly logger = resolve(ILogger).scopeTo('HeldSeatTypeService')
	private readonly authService = resolve(IAuthService)
	private readonly purchased = resolve(IPurchasedTicketStore)
	private readonly orderClient = resolve(IOrderRpcClient)
	private readonly entryClient = resolve(ILotteryEntryRpcClient)
	private readonly checkoutClient = resolve(ICheckoutRpcClient)

	/**
	 * What the fan holds or applied for at `eventId`, or null when nothing
	 * (or for a guest). Reads the fan's tickets with IPurchasedTicketStore
	 * first unless `ticketsLoaded`.
	 */
	public async heldTickets(
		eventId: string,
		tickets: EventTicketSales,
		signal?: AbortSignal,
		ticketsLoaded = false,
	): Promise<HeldTickets | null> {
		if (!this.authService.isAuthenticated || tickets.stocks.length === 0) {
			return null
		}
		const stocks = new Map(tickets.stocks.map((s) => [s.id, s]))
		const found = await Promise.all([
			this.fromTickets(eventId, signal, ticketsLoaded),
			...tickets.sales
				.filter((s) => s.method === 'lottery')
				.map((s) => this.fromEntries(s.id, stocks, signal)),
			this.fromCheckout(eventId, signal),
		])
		for (const f of found) {
			const stock = f.stockIds.map((id) => stocks.get(id)).find((s) => s)
			if (stock) {
				const count = found.reduce((sum, x) => sum + x.count, 0)
				return { stock, count }
			}
		}
		return null
	}

	private async fromTickets(
		eventId: string,
		signal: AbortSignal | undefined,
		ticketsLoaded: boolean,
	): Promise<Found> {
		try {
			if (!ticketsLoaded) await this.purchased.load(signal)
			const orders = await Promise.all(
				this.purchased
					.orderIdsFor(eventId)
					.map((id) => this.orderClient.get(id, signal)),
			)
			return {
				stockIds: orders.map((o) => o.ticketStockId?.value ?? ''),
				count: this.purchased.countFor(eventId),
			}
		} catch (err) {
			if (!signal?.aborted) {
				this.logger.warn('Held tickets read failed', { eventId, error: err })
			}
			return NOTHING
		}
	}

	private async fromEntries(
		saleId: string,
		stocks: ReadonlyMap<string, TicketStock>,
		signal: AbortSignal | undefined,
	): Promise<Found> {
		try {
			const entries = (await this.entryClient.listByTicketSale(saleId, signal))
				// Only this event's entries: a tour sale names other dates too.
				.filter((e) => stocks.has(e.ticketStockId))
			const live = entries.filter(
				(e) => e.state === 'entered' || e.state === 'won',
			)
			return {
				stockIds: live.map((e) => e.ticketStockId),
				count: live
					.filter((e) => e.state === 'entered')
					.reduce((sum, e) => sum + e.ticketCount, 0),
			}
		} catch (err) {
			if (!signal?.aborted) {
				this.logger.warn('Lottery entries read failed', { saleId, error: err })
			}
			return NOTHING
		}
	}

	private async fromCheckout(
		eventId: string,
		signal: AbortSignal | undefined,
	): Promise<Found> {
		const id = loadCheckoutId(eventId)
		if (!id) return NOTHING
		try {
			const checkout = await this.checkoutClient.get(id, signal)
			return checkout.status === 'held' || checkout.status === 'committed'
				? { stockIds: [checkout.ticketStockId], count: checkout.ticketCount }
				: NOTHING
		} catch (err) {
			if (!signal?.aborted) {
				this.logger.warn('Held checkout read failed', { eventId, error: err })
			}
			return NOTHING
		}
	}
}
