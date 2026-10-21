import { existsSync } from 'node:fs'
import {
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	devices,
	expect,
	type Locator,
	type Page,
	test,
} from '@playwright/test'
import { authorizeCard, fillPersonalDetails, holdTickets } from './checkout'
import { listByEvent, openFirstCome, openFreshSale } from './sale'

/**
 * Story `resell-a-ticket` on PRODUCTION in Stripe test mode.
 *
 * The listing fan is the prod E2E test user (`.auth/storageState.prod.json`);
 * the purchasing fan is a second fan (`.auth/storageState.prod.fan2.json`,
 * from `E2E_USERNAME=… E2E_STATE_FILE=storageState.prod.fan2.json npm run
 * auth:capture:password:prod`). "Two fans, one listing" also needs a third
 * fan (`.auth/storageState.prod.fan3.json`) and is skipped without it.
 *
 * Needs a published Event of the test Organizer with a start time more than
 * a day away, by id in `E2E_RESALE_EVENT_ID`, on which neither fan holds
 * tickets, and an organizer access token of the test Organizer in
 * `E2E_ORGANIZER_TOKEN`. The run opens its own first-come sale of 2 tickets
 * at 5000 yen on it (ending the event's open first-come sale first), and the
 * listing fan buys both, so the sale sells out and its resale opens.
 *
 * The tests run in order and share the sale:
 *   1. Sold out, nothing listed: the event page shows 公式リセール, no action.
 *   2. The listing fan lists ticket 1 (5,000円 / 手数料 500円 / 返金 4,500円).
 *   3. The second fan buys it through the checkout's resale confirmation.
 *   4. The listing fan sees ticket 1 リセール済み and refunded within 2 minutes.
 *   5. The listing fan lists ticket 2 and withdraws it: 未入場, no resale offer.
 *   6. Purchase abandoned: ticket 2 listed again, the second fan holds it and
 *      leaves; 16 minutes later the event page offers it again.
 *   7. Two fans, one listing (third fan): one holds it, the other is told it
 *      is sold out for now.
 *
 * Run it in the pinned Playwright container with the host network:
 *   docker run --rm --network host -e E2E_RESALE_EVENT_ID=… \
 *     -e E2E_ORGANIZER_TOKEN -v "$PWD":/work -w /work \
 *     mcr.microsoft.com/playwright:v1.63.0-noble \
 *     npx playwright test -c playwright.prod.config.mjs resell-a-ticket
 *
 * What a browser cannot see is checked separately against production: the
 * listing fan's sold email (`resale_listings.sold_email_send_at`), the
 * refund of 4500 yen on their original charge in the Stripe test dashboard,
 * the Voided listed Ticket, and the two Orders' Held settlements paying the
 * Organizer the same total as before the resale.
 */
const EVENT_ID = process.env.E2E_RESALE_EVENT_ID ?? ''
const ORGANIZER_TOKEN = process.env.E2E_ORGANIZER_TOKEN ?? ''
const SECOND_FAN_STATE = '.auth/storageState.prod.fan2.json'
const THIRD_FAN_STATE = '.auth/storageState.prod.fan3.json'

/** The checkout's 15-minute hold, plus a margin for the sweeper. */
const HOLD_MS = 15 * 60 * 1000
const MARGIN_MS = 60 * 1000

test.describe.configure({ mode: 'serial' })

test.describe('resell a ticket (signed in)', () => {
	let second: BrowserContext
	/** True when an earlier run already sold the sale out to the listing fan. */
	let reused = false

	test.beforeAll(async ({ request, browser, baseURL }) => {
		for (const state of ['.auth/storageState.prod.json', SECOND_FAN_STATE]) {
			if (!existsSync(state)) {
				throw new Error(`${state} is missing: see the spec's header`)
			}
		}
		// A rerun reuses the sale an earlier run sold out to the listing fan.
		reused = await soldOutForResale(request)
		if (EVENT_ID && ORGANIZER_TOKEN && !reused) {
			await openFreshSale(request, EVENT_ID, ORGANIZER_TOKEN, {
				price: 5000,
				quantity: 2,
				perAccountLimit: 2,
			})
		}
		second = await fanContext(browser, baseURL, SECOND_FAN_STATE)
	})

	test.afterAll(async () => {
		await second?.close()
	})

	test.beforeEach(() => {
		test.skip(
			!EVENT_ID || !ORGANIZER_TOKEN,
			'E2E_RESALE_EVENT_ID and E2E_ORGANIZER_TOKEN are required',
		)
	})

	test('sells out to the listing fan; resale opens with nothing listed', async ({
		page,
		request,
	}) => {
		test.setTimeout(5 * 60 * 1000)
		if (!reused) {
			await page.goto(`/events/${EVENT_ID}`)
			await page.getByTestId('event-buy').click()
			await expect(page.getByTestId('checkout-count')).toBeVisible()
			await holdTickets(page, 2)
			await fillPersonalDetails(page)
			await authorizeCard(page)
			await page.getByTestId('checkout-place-order').click()
			await expect(page.getByTestId('checkout-done')).toBeVisible({
				timeout: 60_000,
			})
		}

		const type = openFirstCome(await listByEvent(request, EVENT_ID, 'fan'))
			?.ticketTypes[0]
		expect(type?.state).toBe('TICKET_TYPE_STATE_SOLD_OUT')
		expect(type?.resaleOpen).toBe(true)

		// @spec components/infrastructure/fan/web/route/event "Sold out, nothing listed"
		const other = await second.newPage()
		await other.goto(`/events/${EVENT_ID}`)
		await expect(other.getByTestId('event-sale-sold-out')).toBeVisible()
		await expect(other.getByTestId('event-resale-waiting')).toBeVisible()
		await expect(other.getByTestId('event-resale-buy')).toHaveCount(0)
		await other.close()
	})

	test('lists one ticket after showing the price, fee and refund', async ({
		page,
	}) => {
		// @spec components/infrastructure/fan/web/route/tickets "Fan lists a ticket"
		const cards = await eventCards(page)
		await expect(cards).toHaveCount(2)
		await cards.nth(0).getByTestId('tickets-list-for-resale').click()

		const confirm = page.getByTestId('tickets-resale-confirm')
		await expect(confirm).toContainText('5,000円')
		await expect(confirm).toContainText('500円')
		await expect(confirm).toContainText('4,500円')
		await confirm.getByTestId('tickets-resale-confirm-list').click()

		await expect(cards.nth(0).getByTestId('tickets-state')).toHaveText('出品中')
		await expect(cards.nth(1).getByTestId('tickets-state')).toHaveText('未入場')
	})

	test('another fan buys the resale ticket at face value', async () => {
		// @spec stories/resell-a-ticket "One of two tickets resold"
		// @spec components/infrastructure/fan/web/route/event "Sold out with a resale ticket"
		// @spec components/infrastructure/fan/web/route/checkout "Resale final confirmation"
		test.setTimeout(5 * 60 * 1000)
		const buyer = await second.newPage()
		await buyer.goto(`/events/${EVENT_ID}`)
		await expect(buyer.getByTestId('event-resale-price')).toHaveText(
			'5,000円（税込）',
		)
		await buyer.getByTestId('event-resale-buy').click()
		await expect(buyer.getByTestId('checkout-count')).toBeVisible()
		await holdTickets(buyer, 1)
		await fillPersonalDetails(buyer)
		await authorizeCard(buyer)

		await expect(
			buyer.getByTestId('checkout-confirm-official-resale'),
		).toContainText('券面価格')
		await expect(buyer.getByTestId('checkout-confirm-period')).toContainText(
			'入場開始時',
		)
		const place = buyer.getByTestId('checkout-place-order')
		await expect(place).toContainText('5,000')
		await place.click()
		await expect(buyer.getByTestId('checkout-done')).toBeVisible({
			timeout: 60_000,
		})

		// The purchasing fan holds a new ticket for the event.
		const bought = await eventCards(buyer)
		await expect(bought).toHaveCount(1)
		await expect(bought.nth(0).getByTestId('tickets-state')).toHaveText(
			'未入場',
		)
		await buyer.close()
	})

	test('shows the resold ticket refunded within 2 minutes', async ({
		page,
	}) => {
		// @spec stories/resell-a-ticket "One of two tickets resold"
		// @spec components/infrastructure/fan/web/route/tickets "Refund made"
		test.setTimeout(5 * 60 * 1000)
		const deadline = Date.now() + 2 * 60 * 1000 + 30 * 1000
		let cards = await eventCards(page)
		await expect(cards.nth(0).getByTestId('tickets-state')).toHaveText(
			'リセール済み',
		)
		while (
			!(
				await cards.nth(0).getByTestId('tickets-resold').textContent()
			)?.includes('返金済み') &&
			Date.now() < deadline
		) {
			await page.waitForTimeout(15_000)
			cards = await eventCards(page)
		}
		const resold = cards.nth(0).getByTestId('tickets-resold')
		await expect(resold).toContainText('4,500円')
		await expect(resold).toContainText('返金済み')
		await expect(cards.nth(1).getByTestId('tickets-state')).toHaveText('未入場')
	})

	test('withdraws a listing nobody is buying', async ({ page }) => {
		// @spec stories/resell-a-ticket "Withdrawn first"
		// @spec components/infrastructure/fan/web/route/tickets "Fan withdraws"
		const cards = await eventCards(page)
		await listTicket(page, cards.nth(1))
		await cards.nth(1).getByTestId('tickets-withdraw').click()
		await expect(cards.nth(1).getByTestId('tickets-state')).toHaveText('未入場')

		const other = await second.newPage()
		await other.goto(`/events/${EVENT_ID}`)
		await expect(other.getByTestId('event-resale-waiting')).toBeVisible()
		await expect(other.getByTestId('event-resale-buy')).toHaveCount(0)
		await other.close()
	})

	test('offers the listing again after a purchase is abandoned', async ({
		page,
	}) => {
		// @spec stories/resell-a-ticket "Purchase abandoned"
		test.setTimeout(HOLD_MS + 4 * MARGIN_MS + 5 * 60 * 1000)
		const cards = await eventCards(page)
		await listTicket(page, cards.nth(1))

		const buyer = await second.newPage()
		await buyer.goto(`/events/${EVENT_ID}`)
		await buyer.getByTestId('event-resale-buy').click()
		await holdTickets(buyer, 1)
		await buyer.close()

		const view = await second.newPage()
		await view.goto(`/events/${EVENT_ID}`)
		await expect(view.getByTestId('event-resale-waiting')).toBeVisible()

		// The listing fan cannot withdraw it while it is held.
		// @spec components/infrastructure/fan/web/route/tickets "Someone is buying it"
		await cards.nth(1).getByTestId('tickets-withdraw').click()
		await expect(cards.nth(1)).toContainText('購入手続き中')
		await expect(cards.nth(1).getByTestId('tickets-state')).toHaveText('出品中')

		await view.waitForTimeout(HOLD_MS + MARGIN_MS)
		await view.reload()
		await expect(view.getByTestId('event-resale-buy')).toBeVisible()
		await view.close()
	})

	test('sells one listing to one of two fans and charges only that fan', async ({
		browser,
		baseURL,
	}) => {
		// @spec stories/resell-a-ticket "Two fans, one listing"
		test.skip(!existsSync(THIRD_FAN_STATE), `${THIRD_FAN_STATE} is required`)
		test.setTimeout(10 * 60 * 1000)
		const third = await fanContext(browser, baseURL, THIRD_FAN_STATE)
		const fans = [await second.newPage(), await third.newPage()]
		for (const fan of fans) {
			await fan.goto(`/events/${EVENT_ID}`)
			await fan.getByTestId('event-resale-buy').click()
			await fan.getByTestId('checkout-count-select').selectOption('1')
		}
		const starts = fans.map((fan) =>
			fan.waitForResponse(/CheckoutService\/Start$/),
		)
		await Promise.all(
			fans.map((fan) => fan.getByTestId('checkout-hold').click()),
		)
		const statuses = await Promise.all(
			starts.map(async (start) => (await start).status()),
		)
		// One hold is made; the other Start fails with RESOURCE_EXHAUSTED (429)
		// before any card is authorized.
		expect(statuses.filter((s) => s === 200)).toHaveLength(1)
		expect(statuses.filter((s) => s === 429)).toHaveLength(1)
		const loser = fans[statuses.indexOf(429)]
		await expect(loser.getByTestId('checkout-message')).toHaveText(
			/現在売り切れです|Sold out for now/,
		)
		await third.close()
	})
})

/**
 * True when the event's open first-come sale is already sold out with its
 * resale open, as an earlier run of this spec leaves it.
 */
async function soldOutForResale(request: APIRequestContext): Promise<boolean> {
	if (!EVENT_ID) return false
	const type = openFirstCome(await listByEvent(request, EVENT_ID, 'fan'))
		?.ticketTypes[0]
	return (
		type?.state === 'TICKET_TYPE_STATE_SOLD_OUT' && type.resaleOpen === true
	)
}

/** A signed-in context for another fan, on the project's device. */
async function fanContext(
	browser: Browser,
	baseURL: string | undefined,
	storageState: string,
): Promise<BrowserContext> {
	return browser.newContext({
		...devices['Pixel 7'],
		baseURL,
		locale: 'ja-JP',
		timezoneId: 'Asia/Tokyo',
		storageState,
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

/** List the ticket of the card for official resale. */
async function listTicket(page: Page, card: Locator): Promise<void> {
	await card.getByTestId('tickets-list-for-resale').click()
	await page
		.getByTestId('tickets-resale-confirm')
		.getByTestId('tickets-resale-confirm-list')
		.click()
	await expect(card.getByTestId('tickets-state')).toHaveText('出品中')
}
