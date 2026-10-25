import type { APIRequestContext } from '@playwright/test'
import { getConcert } from './support'

/**
 * The event's ticket sales through the fan and the organizer
 * TicketSaleService, shared by the production purchase specs.
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
	ticketTypes: {
		id: { value: string }
		price: { value: string }
		quantity?: number
		soldCount?: number
		heldCount?: number
		state: string
		resaleOpen?: boolean
		resaleAvailable?: boolean
	}[]
}

const FIRST_COME = 'TICKET_SALE_METHOD_FIRST_COME'

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

/** The event's sales, through the fan or the organizer TicketSaleService. */
export async function listByEvent(
	request: APIRequestContext,
	eventId: string,
	as: 'fan' | 'organizer',
	organizerToken?: string,
): Promise<WireTicketSale[]> {
	const url =
		as === 'fan'
			? `${API_BASE}/liverty_music.rpc.ticket_sale.v1.TicketSaleService/ListByEvent`
			: `${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.ticket_sale.v1.TicketSaleService/ListByEvent`
	const res = await rpc<{ ticketSales?: WireTicketSale[] }>(
		request,
		url,
		{ eventId: { value: eventId } },
		as === 'organizer' ? organizerToken : undefined,
	)
	return res.ticketSales ?? []
}

/** What a fresh first-come sale offers. */
export interface FreshSaleOptions {
	/** Price of one ticket in yen. 3000 when not given. */
	price?: number
	/** Tickets offered. 5 when not given. */
	quantity?: number
	/** Most tickets one account may hold. The quantity, at most 10, when not given. */
	perAccountLimit?: number
}

/**
 * Open a fresh first-come sale on the event as the test Organizer: end the
 * event's open first-come sale now, then create one that starts now and ends
 * at the event's start.
 */
export async function openFreshSale(
	request: APIRequestContext,
	eventId: string,
	organizerToken: string,
	options: FreshSaleOptions = {},
): Promise<void> {
	const organizerUrl = (method: string) =>
		`${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.ticket_sale.v1.TicketSaleService/${method}`
	const now = new Date()
	const open = openFirstCome(
		await listByEvent(request, eventId, 'organizer', organizerToken),
	)
	if (open) {
		await rpc(
			request,
			organizerUrl('SetWindow'),
			{
				ticketSaleId: open.id,
				saleStartTime: open.saleStartTime,
				saleEndTime: now.toISOString(),
			},
			organizerToken,
		)
	}
	const concert = await getConcert(request, eventId)
	await rpc(
		request,
		organizerUrl('Create'),
		{
			seriesId: concert.series.id,
			name: { value: `E2E 先着 ${now.toISOString()}` },
			method: FIRST_COME,
			saleStartTime: now.toISOString(),
			ticketTypes: [
				{
					eventId: { value: eventId },
					price: { value: String(options.price ?? 3000) },
					quantity: options.quantity ?? 5,
					perAccountLimit:
						options.perAccountLimit ?? Math.min(options.quantity ?? 5, 10),
				},
			],
		},
		organizerToken,
	)
}
