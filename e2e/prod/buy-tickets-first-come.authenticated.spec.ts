import { existsSync } from 'node:fs'
import { type APIRequestContext, expect, type Page } from '@playwright/test'
import {
	authorizeCard,
	fillPersonalDetails,
	holdTickets,
	openCheckout as openStockCheckout,
	stockRow,
} from './checkout'
import {
	fanTickets,
	onlyStock,
	openFreshSale,
	organizerStocks,
	SOLD_OUT,
	type SaleStock,
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
 * Story `buy-tickets-first-come` on PRODUCTION in Stripe test mode, signed in
 * as the prod E2E test user (`.auth/storageState.prod.json`).
 *
 * Needs a published Event of the test Organizer, by id in `E2E_SALE_EVENT_ID`,
 * on which the test user holds no tickets, whose per-account limit is at
 * least 5. A run buys up to 5 tickets, and the limit counts every ticket the
 * fan holds or applied for at the Event. The limit is the Event's and can be
 * changed only while the Event is DRAFT, so set it to 5 or more in the concert
 * editor before publishing (Events published before the limit existed have 4).
 * One account also holds one seat type per Event, so each run needs an Event
 * the test user holds no tickets for (docs/prod-e2e-fixtures.md).
 *
 * With the test Organizer's member session
 * (`.auth/storageState.organizer.prod.json`), the run opens its own sale:
 * a fresh SeatType of 3000 yen on the Event's Series, a TicketStock of 5
 * tickets of it, and a first-come sale on the Event, ending the Event's open
 * first-come sale first. Without it, the Event's only stock and its open
 * first-come sale are used as they stand and must have been created the same
 * way in the organizer console.
 *
 * The tests run in order and share the sale:
 *   1. Two tickets bought: 2 sold.
 *   2. Double tap everywhere: 1 sold.
 *   3. Hold ran out: nothing sold (waits out a 15-minute hold).
 *   4. Fan closes the tab: holds every remaining ticket (2), then waits out
 *      the hold (waits 16 minutes).
 *   5. Last ticket, two fans: the test user buys tickets until one remains,
 *      then the test user and a second fan (`.auth/storageState.prod.fan2.json`,
 *      from `E2E_USERNAME=… E2E_STATE_FILE=storageState.prod.fan2.json npm run
 *      auth:capture:password:prod`) start a checkout for it at the same moment.
 *
 * Run it in the pinned Playwright container with the host network, which
 * keeps js.stripe.com reachable from inside it:
 *   docker run --rm --network host -e E2E_SALE_EVENT_ID=… \
 *     -v "$PWD":/work -w /work \
 *     mcr.microsoft.com/playwright:v1.64.1-noble \
 *     npx playwright test -c playwright.prod.config.mjs buy-tickets-first-come
 *
 * What a browser cannot see is checked separately against production:
 * one confirmation email per Order (`orders.confirmation_sent_at`), the card
 * authorization released after an ended hold
 * (`checkouts.authorization_released_at` and Stripe's PaymentIntent
 * canceled), and the ticket journey Paid.
 */
const SALE_EVENT_ID = process.env.E2E_SALE_EVENT_ID ?? ''

/** The stock the run buys from: the fresh one, or the Event's only one. */
let saleStock: SaleStock = { id: '', seatTypeName: '' }

/** The checkout's 15-minute hold, plus a margin for the server's clock. */
const HOLD_MS = 15 * 60 * 1000
const MARGIN_MS = 60 * 1000

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'

/** The stock's seat type price of one ticket in yen, read as a guest. */
async function salePrice(request: APIRequestContext): Promise<number> {
	return stockOf(await fanTickets(request, SALE_EVENT_ID), saleStock.id).price
}

/**
 * The tickets of the stock nobody has bought or holds, as the organizer
 * sees them.
 */
async function remaining(
	request: APIRequestContext,
	organizerToken: string,
): Promise<number> {
	const stock = (
		await organizerStocks(request, SALE_EVENT_ID, organizerToken)
	).find((s) => s.id.value === saleStock.id)
	if (!stock) throw new Error(`the event has no stock ${saleStock.id}`)
	return (stock.quantity ?? 0) - (stock.soldCount ?? 0) - (stock.heldCount ?? 0)
}

/** A yen amount as the checkout writes it, e.g. "6,000". */
const yen = (n: number) => n.toLocaleString('ja-JP')

test.describe.configure({ mode: 'serial' })

test.describe('buy tickets first come (signed in)', () => {
	test.beforeAll(async ({ request, browser }) => {
		if (!existsSync(FAN_STATE)) {
			throw new Error(
				`${FAN_STATE} is missing: run npm run auth:capture:password:prod`,
			)
		}
		if (!SALE_EVENT_ID) return
		saleStock = hasOrganizerSession()
			? await openFreshSale(
					request,
					SALE_EVENT_ID,
					await organizerToken(browser),
				)
			: await onlyStock(request, SALE_EVENT_ID)
	})

	test.beforeEach(() => {
		test.skip(!SALE_EVENT_ID, 'E2E_SALE_EVENT_ID is required')
	})

	test('buys two tickets and finds them in Tickets', async ({
		page,
		request,
	}) => {
		// @spec stories/buy-tickets-first-come "Two tickets bought"
		const total = yen((await salePrice(request)) * 2)
		await openCheckout(page)
		await holdTickets(page, 2)
		await fillPersonalDetails(page)
		await authorizeCard(page)

		const place = page.getByTestId('checkout-place-order')
		// The action states what it pays, in the fan's display language.
		await expect(place).toContainText(total)
		await place.click()

		await expect(page.getByTestId('checkout-done')).toBeVisible({
			timeout: 60_000,
		})
		const summary = page.getByTestId('checkout-done-summary')
		await expect(summary).toContainText(/2枚|2 tickets/)
		await expect(summary).toContainText(total)
		await page.getByTestId('checkout-to-tickets').click()
		await expect(page).toHaveURL(/\/tickets$/)
		await expect(page.locator('.tickets-list')).toBeVisible({
			timeout: 30_000,
		})
	})

	test('holds, charges and orders once on double taps', async ({
		page,
		request,
	}) => {
		// @spec stories/buy-tickets-first-come "Double tap everywhere"
		await openCheckout(page)
		await page.getByTestId('checkout-count-select').selectOption('1')
		const started = page.waitForResponse(/CheckoutService\/Start$/)
		await page.getByTestId('checkout-hold').dblclick()
		const start = (await (await started).json()) as {
			checkout: { id: { value: string } }
		}
		await expect(page.getByTestId('checkout-personal-details')).toBeVisible()
		await fillPersonalDetails(page)
		await authorizeCard(page)

		const confirmed = page.waitForResponse(/CheckoutService\/Confirm$/)
		await page.getByTestId('checkout-place-order').dblclick()
		const first = (await (await confirmed).json()) as {
			order: { id: { value: string } }
		}
		await expect(page.getByTestId('checkout-done')).toBeVisible({
			timeout: 60_000,
		})
		await expect(page.getByTestId('checkout-done-summary')).toContainText(
			/1枚|1 tickets?/,
		)

		// The page disables its buttons while a request is in flight, so a
		// double tap sends one request. Place the same order again past the
		// page, as a second tab would: the server returns the same Order and
		// charges nothing more.
		const again = await request.post(
			`${API_BASE}/liverty_music.rpc.checkout.v1.CheckoutService/Confirm`,
			{
				data: { checkoutId: { value: start.checkout.id.value } },
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${await accessToken(page)}`,
				},
			},
		)
		expect(again.ok()).toBe(true)
		const second = (await again.json()) as { order: { id: { value: string } } }
		expect(second.order.id.value).toBe(first.order.id.value)
	})

	test('refuses the order after the hold ran out', async ({ page }) => {
		// @spec stories/buy-tickets-first-come "Hold ran out"
		test.setTimeout(HOLD_MS + MARGIN_MS + 5 * 60 * 1000)
		await openCheckout(page)
		await holdTickets(page, 1)
		await fillPersonalDetails(page)
		await authorizeCard(page)

		await page.waitForTimeout(HOLD_MS + MARGIN_MS)
		await page.getByTestId('checkout-place-order').click()

		const outcome = page.getByTestId('checkout-outcome')
		await expect(outcome).toHaveAttribute('data-outcome', 'hold-ended', {
			timeout: 60_000,
		})
	})

	test('puts the tickets back on sale after the fan leaves', async ({
		page,
		browser,
		baseURL,
	}) => {
		// @spec stories/buy-tickets-first-come "Fan closes the tab"
		test.setTimeout(HOLD_MS + 4 * MARGIN_MS + 5 * 60 * 1000)
		await openCheckout(page)
		await holdTickets(page, 2)
		await fillPersonalDetails(page)
		await authorizeCard(page)
		await page.close()

		// A guest sees every remaining ticket held by a checkout.
		const guest = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] },
		})
		const view = await guest.newPage()
		await view.goto(`/events/${SALE_EVENT_ID}`)
		await expect(stockRow(view, saleStock)).toHaveAttribute(
			'data-stock-state',
			'allHeld',
		)

		// By 16 minutes after the hold started, the tickets are on sale again.
		await view.waitForTimeout(HOLD_MS + MARGIN_MS)
		await view.reload()
		await expect(stockRow(view, saleStock)).toHaveAttribute(
			'data-stock-state',
			'available',
		)
		await guest.close()
	})

	test('sells the last ticket to one of two fans and charges only that fan', async ({
		page,
		browser,
		baseURL,
		request,
	}) => {
		// @spec stories/buy-tickets-first-come "Last ticket, two fans"
		test.skip(!existsSync(SECOND_FAN_STATE), `${SECOND_FAN_STATE} is required`)
		test.setTimeout(10 * 60 * 1000)
		// Buy until one ticket remains: 2 remain after the tests above.
		const left = hasOrganizerSession()
			? await remaining(request, await organizerToken(browser))
			: 2
		for (let i = 1; i < left; i++) await buyOne(page)

		const second = await fanContext(browser, baseURL, SECOND_FAN_STATE)
		const other = await second.newPage()
		await Promise.all([openCheckout(page), openCheckout(other)])
		const fans = [page, other]
		for (const fan of fans) {
			await fan.getByTestId('checkout-count-select').selectOption('1')
		}

		// Both fans continue at the same moment.
		const starts = fans.map((fan) =>
			fan.waitForResponse(/CheckoutService\/Start$/),
		)
		await Promise.all(
			fans.map((fan) => fan.getByTestId('checkout-hold').click()),
		)
		const statuses = await Promise.all(
			starts.map(async (start) => (await start).status()),
		)
		// One hold is made; the other Start fails with RESOURCE_EXHAUSTED
		// (HTTP 429), so that fan has no checkout and no card authorization.
		expect(statuses.filter((s) => s === 200)).toHaveLength(1)
		expect(statuses.filter((s) => s === 429)).toHaveLength(1)
		const winner = fans[statuses.indexOf(200)]
		const loser = fans[statuses.indexOf(429)]

		await expect(loser.getByTestId('checkout-message')).toHaveText(
			/現在売り切れです|Sold out for now/,
		)
		await expect(loser.getByTestId('checkout-personal-details')).toBeHidden()

		await expect(winner.getByTestId('checkout-personal-details')).toBeVisible()
		await fillPersonalDetails(winner)
		await authorizeCard(winner)
		await winner.getByTestId('checkout-place-order').click()
		await expect(winner.getByTestId('checkout-done')).toBeVisible({
			timeout: 60_000,
		})
		await expect(winner.getByTestId('checkout-done-summary')).toContainText(
			/1枚|1 tickets?/,
		)
		await closeFan(second, SECOND_FAN_STATE)

		// The last ticket is sold: the stock is sold out, not held.
		const { stock } = stockOf(
			await fanTickets(request, SALE_EVENT_ID),
			saleStock.id,
		)
		expect(stock.state).toBe(SOLD_OUT)
	})
})

/** Buy one ticket through the whole checkout. */
async function buyOne(page: Page): Promise<void> {
	await openCheckout(page)
	await holdTickets(page, 1)
	await fillPersonalDetails(page)
	await authorizeCard(page)
	await page.getByTestId('checkout-place-order').click()
	await expect(page.getByTestId('checkout-done')).toBeVisible({
		timeout: 60_000,
	})
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

/** Open the checkout from the action to buy on the stock's seat type. */
async function openCheckout(page: Page): Promise<void> {
	await openStockCheckout(page, SALE_EVENT_ID, saleStock)
}
