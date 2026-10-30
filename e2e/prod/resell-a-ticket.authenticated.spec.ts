import { existsSync } from 'node:fs'
import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Locator,
	type Page,
} from '@playwright/test'
import {
	authorizeCard,
	fillPersonalDetails,
	holdTickets,
	openCheckout,
	stockRow,
} from './checkout'
import {
	fanTickets,
	openFreshSale,
	type SaleStock,
	SOLD_OUT,
	stockOf,
} from './sale'
import {
	closeFan,
	FAN_STATE,
	fanContext,
	hasOrganizerSession,
	organizerToken,
	SECOND_FAN_STATE,
	test,
} from './session'

/**
 * Story `resell-a-ticket` on PRODUCTION in Stripe test mode: a ticket of a
 * sold-out seat type is listed. Buying a listed ticket arrives with the change
 * `resell-tickets-by-lottery`; until then no fan can buy one, and this spec
 * checks that the event page offers no purchase.
 *
 * The listing fan is the prod E2E test user (`.auth/storageState.prod.json`);
 * a second fan (`.auth/storageState.prod.fan2.json`, from `E2E_USERNAME=…
 * E2E_STATE_FILE=storageState.prod.fan2.json npm run
 * auth:capture:password:prod`) looks at the event page.
 *
 * Needs a published Event of the test Organizer with a start time more than
 * a day away, by id in `E2E_RESALE_EVENT_ID`, on which neither fan holds
 * tickets, whose per-account limit is at least 2 (Events have 4 unless set
 * otherwise while DRAFT; the limit is fixed once the Event is published), and
 * the test Organizer's member session
 * (`.auth/storageState.organizer.prod.json`). The run opens its own sale: a
 * fresh SeatType of 5000 yen with a TicketStock of 2 tickets and a first-come
 * sale on the Event (ending the Event's open first-come sale first). The
 * listing fan buys both, so the stock sells out and its resale opens. Each run
 * needs a new Event, unless the run ended right after the stock sold out (a
 * rerun picks that stock up) (docs/prod-e2e-fixtures.md).
 *
 * The tests run in order and share the stock:
 *   1. Sold out with resale open: the event page shows 公式リセール, no action.
 *   2. The listing fan lists ticket 1 (5,000円 / 手数料 500円 / 返金 4,500円);
 *      ResaleListingService.List shows it Listed at 5000 yen and both
 *      Tickets stay Issued and not admitted.
 *   3. The listing fan withdraws it: 未入場, and still no purchase offered.
 *
 * "Lottery-won ticket listed" needs a drawn lottery and is covered by the
 * backend story test.
 *
 * Run it in the pinned Playwright container with the host network:
 *   docker run --rm --network host -e E2E_RESALE_EVENT_ID=… \
 *     -v "$PWD":/work -w /work \
 *     mcr.microsoft.com/playwright:v1.64.1-noble \
 *     npx playwright test -c playwright.prod.config.mjs resell-a-ticket
 */
const EVENT_ID = process.env.E2E_RESALE_EVENT_ID ?? ''

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'

/** Ticket states as shown in either display language (a fan's own setting). */
const LISTED = /出品中|Listed for resale/
const NOT_ENTERED = /未入場|Not entered/

test.describe.configure({ mode: 'serial' })

test.describe('resell a ticket (signed in)', () => {
	let second: BrowserContext
	/** The stock the run sells out: the fresh one, or one a rerun picks up. */
	let saleStock: SaleStock = { id: '', seatTypeName: '' }
	/** True when an earlier run already sold the stock out to the listing fan. */
	let reused = false

	test.beforeAll(async ({ request, browser, baseURL }) => {
		for (const state of [FAN_STATE, SECOND_FAN_STATE]) {
			if (!existsSync(state)) {
				throw new Error(`${state} is missing: see the spec's header`)
			}
		}
		if (!EVENT_ID || !hasOrganizerSession()) return
		// A rerun reuses the stock an earlier run sold out to the listing fan.
		const soldOut = await soldOutForResale(request)
		reused = soldOut !== null
		saleStock =
			soldOut ??
			(await openFreshSale(request, EVENT_ID, await organizerToken(browser), {
				price: 5000,
				quantity: 2,
			}))
		second = await fanContext(browser, baseURL, SECOND_FAN_STATE)
	})

	test.afterAll(async () => {
		if (second) await closeFan(second, SECOND_FAN_STATE)
	})

	test.beforeEach(() => {
		test.skip(
			!EVENT_ID || !hasOrganizerSession(),
			'E2E_RESALE_EVENT_ID and the organizer member session are required',
		)
	})

	test('sells out to the listing fan; resale opens and no purchase is offered', async ({
		page,
		request,
	}) => {
		test.setTimeout(5 * 60 * 1000)
		if (!reused) {
			await openCheckout(page, EVENT_ID, saleStock)
			await holdTickets(page, 2)
			await fillPersonalDetails(page)
			await authorizeCard(page)
			await page.getByTestId('checkout-place-order').click()
			await expect(page.getByTestId('checkout-done')).toBeVisible({
				timeout: 60_000,
			})
		}

		const { stock } = stockOf(await fanTickets(request, EVENT_ID), saleStock.id)
		expect(stock.state).toBe(SOLD_OUT)
		expect(stock.resaleOpen).toBe(true)

		// @spec components/infrastructure/fan/web/route/event "Sold out with resale open"
		const other = await second.newPage()
		await other.goto(`/events/${EVENT_ID}`)
		const row = stockRow(other, saleStock)
		await expect(row.getByTestId('event-sale-sold-out')).toBeVisible()
		await expect(row.getByTestId('event-resale-listing')).toBeVisible()
		await expect(row.getByTestId('event-buy')).toHaveCount(0)
		await other.close()
	})

	test('lists one of two tickets after showing the price, fee and refund', async ({
		page,
	}) => {
		// @spec components/infrastructure/fan/web/route/tickets "Fan lists a ticket"
		// @spec stories/resell-a-ticket "One of two tickets listed"
		const cards = await eventCards(page)
		await expect(cards).toHaveCount(2)
		await cards.nth(0).getByTestId('tickets-list-for-resale').click()

		const confirm = page.getByTestId('tickets-resale-confirm')
		await expect(confirm).toContainText('5,000')
		await expect(confirm).toContainText(/[^,\d]500/)
		await expect(confirm).toContainText('4,500')
		await confirm.getByTestId('tickets-resale-confirm-list').click()

		await expect(cards.nth(0).getByTestId('tickets-state')).toHaveText(LISTED)
		await expect(cards.nth(1).getByTestId('tickets-state')).toHaveText(
			NOT_ENTERED,
		)

		// The listing is Listed at face value, and both Tickets stay valid for
		// entry: Issued and not admitted.
		const token = await accessToken(page)
		const { resaleListings = [] } = await fanRpc<{
			resaleListings?: {
				ticketId: { value: string }
				ticketStockId?: { value: string }
				status: string
				price: { value: string }
			}[]
		}>(page.request, 'resale_listing.v1.ResaleListingService/List', token)
		const listed = resaleListings.filter(
			(l) =>
				l.ticketStockId?.value === saleStock.id &&
				l.status === 'RESALE_LISTING_STATUS_LISTED',
		)
		expect(listed).toHaveLength(1)
		expect(listed[0].price.value).toBe('5000')
		const { tickets = [] } = await fanRpc<{
			tickets?: {
				eventId: { value: string }
				status: string
				admitTime?: string
			}[]
		}>(page.request, 'ticket.v1.TicketService/List', token)
		const ofEvent = tickets.filter((t) => t.eventId.value === EVENT_ID)
		expect(ofEvent).toHaveLength(2)
		for (const t of ofEvent) {
			expect(t.status).toBe('TICKET_STATUS_ISSUED')
			expect(t.admitTime).toBeUndefined()
		}
	})

	test('withdraws the listing; still no purchase is offered', async ({
		page,
	}) => {
		// @spec components/infrastructure/fan/web/route/tickets "Fan withdraws"
		const cards = await eventCards(page)
		await expect(cards.nth(0).getByTestId('tickets-state')).toHaveText(LISTED)
		await cards.nth(0).getByTestId('tickets-withdraw').click()
		await expect(cards.nth(0).getByTestId('tickets-state')).toHaveText(
			NOT_ENTERED,
		)

		const other = await second.newPage()
		await other.goto(`/events/${EVENT_ID}`)
		const row = stockRow(other, saleStock)
		await expect(row.getByTestId('event-resale-listing')).toBeVisible()
		await expect(row.getByTestId('event-buy')).toHaveCount(0)
		await other.close()
	})
})

/**
 * The Event's stock that is already sold out with its resale open, as an
 * earlier run of this spec leaves it, or null.
 */
async function soldOutForResale(
	request: APIRequestContext,
): Promise<SaleStock | null> {
	const tickets = await fanTickets(request, EVENT_ID)
	const stock = tickets.stocks.find(
		(s) => s.state === SOLD_OUT && s.resaleOpen === true,
	)
	if (!stock) return null
	return {
		id: stock.id.value,
		seatTypeName: stockOf(tickets, stock.id.value).seatTypeName,
	}
}

/** A fan RPC with an empty request, as the signed-in fan. */
async function fanRpc<T>(
	request: APIRequestContext,
	method: string,
	token: string,
): Promise<T> {
	const res = await request.post(`${API_BASE}/liverty_music.rpc.${method}`, {
		data: {},
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${token}`,
		},
	})
	if (!res.ok()) {
		throw new Error(`${method} failed: ${res.status()} ${await res.text()}`)
	}
	return (await res.json()) as T
}

/** The signed-in fan's access token, as the app keeps it. */
async function accessToken(page: Page): Promise<string> {
	return page.evaluate(() => {
		const key = Object.keys(localStorage).find((k) =>
			k.startsWith('oidc.user:'),
		)
		const user = key ? JSON.parse(localStorage.getItem(key) ?? '{}') : {}
		return (user as { access_token?: string }).access_token ?? ''
	})
}

/** The fan's ticket cards for the event, on a freshly loaded Tickets screen. */
async function eventCards(page: Page): Promise<Locator> {
	await page.goto('/tickets')
	const section = page.locator(
		`section[aria-labelledby="tickets-event-${EVENT_ID}"]`,
	)
	await expect(section).toBeVisible({ timeout: 30_000 })
	return section.locator('li.tickets-card')
}
