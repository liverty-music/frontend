import type { APIRequestContext } from '@playwright/test'
import { getConcert } from './support'

/**
 * The event's ticket sales and ticket stocks through the fan and the
 * organizer APIs, shared by the production purchase specs.
 *
 * A sale sells every TicketStock of the events it names; a stock is one
 * SeatType (name and price) of one event. The fan API returns each stock's
 * state, never its counts; the organizer TicketStockService returns the
 * counts.
 */

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'
const ORGANIZER_API_BASE =
	process.env.PROD_ORGANIZER_API_BASE_URL ??
	'https://api.organizer.liverty-music.app'

/** The fields of a TicketSale in Connect JSON that the tests read. */
export interface WireTicketSale {
	id: { value: string }
	method: string
	saleStartTime: string
	saleEndTime: string
	eventIds?: { value: string }[]
}

/**
 * The fields of a TicketStock in Connect JSON. The counts are present only
 * on the organizer read; zero counts and false flags are omitted.
 */
export interface WireTicketStock {
	id: { value: string }
	eventId: { value: string }
	seatTypeId: { value: string }
	/** `TICKET_STOCK_STATE_*`. */
	state?: string
	lowStock?: boolean
	resaleOpen?: boolean
	quantity?: number
	soldCount?: number
	heldCount?: number
}

/** The fields of a SeatType in Connect JSON. */
export interface WireSeatType {
	id: { value: string }
	name: { value: string }
	/** Price of one ticket in yen, as an int64 string. */
	price: { value: string }
}

/** The fan `TicketSaleService.ListByEvent` answer. */
export interface FanTickets {
	sales: WireTicketSale[]
	stocks: WireTicketStock[]
	seatTypes: WireSeatType[]
	perAccountLimit?: number
}

/** The stock a run buys from, with its seat type's name for the event page. */
export interface SaleStock {
	id: string
	seatTypeName: string
}

const FIRST_COME = 'TICKET_SALE_METHOD_FIRST_COME'
export const SOLD_OUT = 'TICKET_STOCK_STATE_SOLD_OUT'

/** The event's first-come sale whose window is open now, if any. */
export function openFirstCome(
	sales: WireTicketSale[],
): WireTicketSale | undefined {
	const now = Date.now()
	return sales.find(
		(s) =>
			s.method === FIRST_COME &&
			Date.parse(s.saleStartTime) <= now &&
			now < Date.parse(s.saleEndTime),
	)
}

async function rpc<T>(
	request: APIRequestContext,
	url: string,
	body: unknown,
	token?: string,
): Promise<T> {
	const res = await request.post(url, {
		data: body,
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
	})
	if (!res.ok()) {
		throw new Error(`${url} failed: ${res.status()} ${await res.text()}`)
	}
	return (await res.json()) as T
}

const organizerUrl = (service: string, method: string) =>
	`${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.${service}/${method}`

/** The event's sales, stocks and seat types, read as a guest. */
export async function fanTickets(
	request: APIRequestContext,
	eventId: string,
): Promise<FanTickets> {
	const res = await rpc<{
		ticketSales?: WireTicketSale[]
		ticketStocks?: WireTicketStock[]
		seatTypes?: WireSeatType[]
		perAccountLimit?: number
	}>(
		request,
		`${API_BASE}/liverty_music.rpc.ticket_sale.v1.TicketSaleService/ListByEvent`,
		{ eventId: { value: eventId } },
	)
	return {
		sales: res.ticketSales ?? [],
		stocks: res.ticketStocks ?? [],
		seatTypes: res.seatTypes ?? [],
		perAccountLimit: res.perAccountLimit,
	}
}

/** The event's sales, read as the Organizer. */
export async function organizerSales(
	request: APIRequestContext,
	eventId: string,
	organizerToken: string,
): Promise<WireTicketSale[]> {
	const res = await rpc<{ ticketSales?: WireTicketSale[] }>(
		request,
		organizerUrl('ticket_sale.v1.TicketSaleService', 'ListByEvent'),
		{ eventId: { value: eventId } },
		organizerToken,
	)
	return res.ticketSales ?? []
}

/** The event's stocks with their counts, read as the Organizer. */
export async function organizerStocks(
	request: APIRequestContext,
	eventId: string,
	organizerToken: string,
): Promise<WireTicketStock[]> {
	const res = await rpc<{ ticketStocks?: WireTicketStock[] }>(
		request,
		organizerUrl('ticket_stock.v1.TicketStockService', 'ListByEvent'),
		{ eventId: { value: eventId } },
		organizerToken,
	)
	return res.ticketStocks ?? []
}

/** The stock of `stockId` in a fan read, with its seat type's price in yen. */
export function stockOf(
	tickets: FanTickets,
	stockId: string,
): { stock: WireTicketStock; price: number; seatTypeName: string } {
	const stock = tickets.stocks.find((s) => s.id.value === stockId)
	if (!stock) throw new Error(`the event has no stock ${stockId}`)
	const seatType = tickets.seatTypes.find(
		(t) => t.id.value === stock.seatTypeId.value,
	)
	return {
		stock,
		price: Number(seatType?.price.value ?? 0),
		seatTypeName: seatType?.name.value ?? '',
	}
}

/**
 * The stock a run buys from when it opened no sale of its own: the event's
 * only stock. Several stocks are left by earlier runs that had the
 * Organizer's session; such an event needs that session.
 */
export async function onlyStock(
	request: APIRequestContext,
	eventId: string,
): Promise<SaleStock> {
	const tickets = await fanTickets(request, eventId)
	if (tickets.stocks.length !== 1) {
		throw new Error(
			`the event has ${tickets.stocks.length} stocks; run with the organizer session`,
		)
	}
	const id = tickets.stocks[0].id.value
	return { id, seatTypeName: stockOf(tickets, id).seatTypeName }
}

/** What a fresh first-come sale offers. */
export interface FreshSaleOptions {
	/** Price of one ticket in yen. 3000 when not given. */
	price?: number
	/** Tickets offered. 5 when not given. */
	quantity?: number
}

/**
 * Open a fresh first-come sale on the event as the test Organizer:
 *   1. add a fresh SeatType to the event's Series, named by the time (seat
 *      type names are unique per Series);
 *   2. stock it for the event with `quantity` tickets;
 *   3. end the event's open first-come sale now;
 *   4. create a first-come sale on the event that starts now and ends at the
 *      event's start.
 * The per-account limit is the event's, fixed once it is published, so it
 * is not set here. Returns the new stock.
 */
export async function openFreshSale(
	request: APIRequestContext,
	eventId: string,
	organizerToken: string,
	options: FreshSaleOptions = {},
): Promise<SaleStock> {
	const now = new Date()
	const concert = await getConcert(request, eventId)
	if (!concert.startTime) {
		throw new Error(`event ${eventId} has no start time to end the sale at`)
	}

	const seatTypeName = `E2E ${now.toISOString()}`
	const { seatType } = await rpc<{ seatType: WireSeatType }>(
		request,
		organizerUrl('seat_type.v1.SeatTypeService', 'Create'),
		{
			seriesId: concert.series.id,
			name: { value: seatTypeName },
			price: { value: String(options.price ?? 3000) },
		},
		organizerToken,
	)
	const { ticketStock } = await rpc<{ ticketStock: WireTicketStock }>(
		request,
		organizerUrl('ticket_stock.v1.TicketStockService', 'Create'),
		{
			eventId: { value: eventId },
			seatTypeId: seatType.id,
			quantity: options.quantity ?? 5,
		},
		organizerToken,
	)

	const saleUrl = (method: string) =>
		organizerUrl('ticket_sale.v1.TicketSaleService', method)
	const open = openFirstCome(
		await organizerSales(request, eventId, organizerToken),
	)
	if (open) {
		await rpc(
			request,
			saleUrl('SetWindow'),
			{
				ticketSaleId: open.id,
				saleStartTime: open.saleStartTime,
				saleEndTime: now.toISOString(),
			},
			organizerToken,
		)
	}
	await rpc(
		request,
		saleUrl('Create'),
		{
			seriesId: concert.series.id,
			name: { value: `E2E 先着 ${now.toISOString()}` },
			method: FIRST_COME,
			saleStartTime: now.toISOString(),
			saleEndTime: concert.startTime,
			eventIds: [{ value: eventId }],
		},
		organizerToken,
	)
	return { id: ticketStock.id.value, seatTypeName }
}
