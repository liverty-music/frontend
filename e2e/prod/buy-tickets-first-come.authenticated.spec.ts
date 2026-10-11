import { existsSync } from 'node:fs'
import {
	type APIRequestContext,
	type Browser,
	type BrowserContext,
	devices,
	expect,
	type Frame,
	type Page,
	test,
} from '@playwright/test'
import { getConcert } from './support'

/**
 * Story `buy-tickets-first-come` on PRODUCTION in Stripe test mode, signed in
 * as the prod E2E test user (`.auth/storageState.prod.json`).
 *
 * Needs a published Event of the test Organizer, by id in `E2E_SALE_EVENT_ID`,
 * on which the test user holds no tickets (its Tickets for the event count
 * against the per-account limit). With an organizer access token of the test
 * Organizer in `E2E_ORGANIZER_TOKEN`, the run opens its own first-come sale on
 * that event through the organizer `TicketSaleService.Create` (5 tickets of
 * 3000 yen, a per-account limit of 10), ending the event's open first-come sale
 * first. Without it, the event's open first-come sale is used as it stands and
 * must have been created the same way in the organizer console.
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
 *     -e E2E_ORGANIZER_TOKEN -v "$PWD":/work -w /work \
 *     mcr.microsoft.com/playwright:v1.63.0-noble \
 *     npx playwright test -c playwright.prod.config.mjs buy-tickets-first-come
 *
 * What a browser cannot see is checked separately against production:
 * one confirmation email per Order (`orders.confirmation_sent_at`), the card
 * hold released after an ended hold (`checkouts.authorization_released_at`
 * and the PaymentIntent canceled), and the ticket journey Paid.
 */
const SALE_EVENT_ID = process.env.E2E_SALE_EVENT_ID ?? ''
const ORGANIZER_TOKEN = process.env.E2E_ORGANIZER_TOKEN ?? ''
const SECOND_FAN_STATE = '.auth/storageState.prod.fan2.json'

/** Stripe's test card that authorizes without 3D Secure. */
const TEST_CARD = { number: '4242424242424242', expiry: '12 / 34', cvc: '123' }

/** The checkout's 15-minute hold, plus a margin for the server's clock. */
const HOLD_MS = 15 * 60 * 1000
const MARGIN_MS = 60 * 1000

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'
const ORGANIZER_API_BASE =
	process.env.PROD_ORGANIZER_API_BASE_URL ??
	'https://api.organizer.liverty-music.app'

/** The fields of a TicketSale in Connect JSON that the tests read. */
interface WireTicketSale {
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
	}[]
}

const FIRST_COME = 'TICKET_SALE_METHOD_FIRST_COME'

/** The event's first-come sale whose window is open now, if any. */
function openFirstCome(sales: WireTicketSale[]): WireTicketSale | undefined {
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
async function listByEvent(
	request: APIRequestContext,
	as: 'fan' | 'organizer',
): Promise<WireTicketSale[]> {
	const url =
		as === 'fan'
			? `${API_BASE}/liverty_music.rpc.ticket_sale.v1.TicketSaleService/ListByEvent`
			: `${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.ticket_sale.v1.TicketSaleService/ListByEvent`
	const res = await rpc<{ ticketSales?: WireTicketSale[] }>(
		request,
		url,
		{ eventId: { value: SALE_EVENT_ID } },
		as === 'organizer' ? ORGANIZER_TOKEN : undefined,
	)
	return res.ticketSales ?? []
}

/**
 * Open a fresh first-come sale on the event as the test Organizer: end the
 * event's open first-come sale now, then create one that starts now and ends
 * at the event's start.
 */
async function openFreshSale(request: APIRequestContext): Promise<void> {
	const organizerUrl = (method: string) =>
		`${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.ticket_sale.v1.TicketSaleService/${method}`
	const now = new Date()
	const open = openFirstCome(await listByEvent(request, 'organizer'))
	if (open) {
		await rpc(
			request,
			organizerUrl('SetWindow'),
			{
				ticketSaleId: open.id,
				saleStartTime: open.saleStartTime,
				saleEndTime: now.toISOString(),
			},
			ORGANIZER_TOKEN,
		)
	}
	const concert = await getConcert(request, SALE_EVENT_ID)
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
					eventId: { value: SALE_EVENT_ID },
					price: { value: '3000' },
					quantity: 5,
					perAccountLimit: 10,
				},
			],
		},
		ORGANIZER_TOKEN,
	)
}

/** The sale's price of one ticket in yen, read as a guest. */
async function salePrice(request: APIRequestContext): Promise<number> {
	const sale = openFirstCome(await listByEvent(request, 'fan'))
	expect(sale, 'the event has an open first-come sale').toBeDefined()
	return Number(sale?.ticketTypes[0].price.value)
}

/**
 * The tickets of the open sale nobody has bought or holds, as the organizer
 * sees them. Undefined without an organizer token.
 */
async function remaining(
	request: APIRequestContext,
): Promise<number | undefined> {
	if (!ORGANIZER_TOKEN) return undefined
	const type = openFirstCome(await listByEvent(request, 'organizer'))
		?.ticketTypes[0]
	if (!type) throw new Error('the event has no open first-come sale')
	return (type.quantity ?? 0) - (type.soldCount ?? 0) - (type.heldCount ?? 0)
}

/** A yen amount as the checkout writes it, e.g. "6,000". */
const yen = (n: number) => n.toLocaleString('ja-JP')

test.describe.configure({ mode: 'serial' })

test.describe('buy tickets first come (signed in)', () => {
	test.beforeAll(async ({ request }) => {
		if (!existsSync('.auth/storageState.prod.json')) {
			throw new Error(
				'.auth/storageState.prod.json is missing: run npm run auth:capture:password:prod',
			)
		}
		if (SALE_EVENT_ID && ORGANIZER_TOKEN) await openFreshSale(request)
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
		await fillIdentity(page)
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
		await expect(page.locator('.tickets-list')).toBeVisible({ timeout: 30_000 })
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
		await expect(page.getByTestId('checkout-identity')).toBeVisible()
		await fillIdentity(page)
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
		await fillIdentity(page)
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
		await fillIdentity(page)
		await authorizeCard(page)
		await page.close()

		// A guest sees every remaining ticket held by a checkout.
		const guest = await browser.newContext({
			baseURL,
			storageState: { cookies: [], origins: [] },
		})
		const view = await guest.newPage()
		await view.goto(`/events/${SALE_EVENT_ID}`)
		await expect(view.getByTestId('event-sale')).toHaveAttribute(
			'data-sale-state',
			'allHeld',
		)

		// By 16 minutes after the hold started, the tickets are on sale again.
		await view.waitForTimeout(HOLD_MS + MARGIN_MS)
		await view.reload()
		await expect(view.getByTestId('event-sale')).toHaveAttribute(
			'data-sale-state',
			'onSale',
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
		const left = (await remaining(request)) ?? 2
		for (let i = 1; i < left; i++) await buyOne(page)

		const second = await secondFan(browser, baseURL)
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
		// (HTTP 429), so that fan has no checkout and no card hold.
		expect(statuses.filter((s) => s === 200)).toHaveLength(1)
		expect(statuses.filter((s) => s === 429)).toHaveLength(1)
		const winner = fans[statuses.indexOf(200)]
		const loser = fans[statuses.indexOf(429)]

		await expect(loser.getByTestId('checkout-message')).toHaveText(
			/現在売り切れです|Sold out for now/,
		)
		await expect(loser.getByTestId('checkout-identity')).toBeHidden()

		await expect(winner.getByTestId('checkout-identity')).toBeVisible()
		await fillIdentity(winner)
		await authorizeCard(winner)
		await winner.getByTestId('checkout-place-order').click()
		await expect(winner.getByTestId('checkout-done')).toBeVisible({
			timeout: 60_000,
		})
		await expect(winner.getByTestId('checkout-done-summary')).toContainText(
			/1枚|1 tickets?/,
		)
		await second.close()

		// The last ticket is sold: the sale is sold out, not held.
		const sale = openFirstCome(await listByEvent(request, 'fan'))
		expect(sale?.ticketTypes[0].state).toBe('TICKET_TYPE_STATE_SOLD_OUT')
	})
})

/** A signed-in context for the second fan, on the project's device. */
async function secondFan(
	browser: Browser,
	baseURL: string | undefined,
): Promise<BrowserContext> {
	return browser.newContext({
		...devices['Pixel 7'],
		baseURL,
		locale: 'ja-JP',
		timezoneId: 'Asia/Tokyo',
		storageState: SECOND_FAN_STATE,
	})
}

/** Buy one ticket through the whole checkout. */
async function buyOne(page: Page): Promise<void> {
	await openCheckout(page)
	await holdTickets(page, 1)
	await fillIdentity(page)
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

/** Open the checkout from the Event page's action to buy. */
async function openCheckout(page: Page): Promise<void> {
	await page.goto(`/events/${SALE_EVENT_ID}`)
	await page.getByTestId('event-buy').click()
	await expect(page).toHaveURL(new RegExp(`/events/${SALE_EVENT_ID}/checkout$`))
	await expect(page.getByTestId('checkout-count')).toBeVisible()
}

async function holdTickets(page: Page, count: number): Promise<void> {
	await page.getByTestId('checkout-count-select').selectOption(String(count))
	await page.getByTestId('checkout-hold').click()
	await expect(page.getByTestId('checkout-identity')).toBeVisible()
	await expect(page.getByTestId('checkout-countdown')).toBeVisible()
}

/** Keep the prefilled identity, or fill it in on the first checkout. */
async function fillIdentity(page: Page): Promise<void> {
	const name = page.getByTestId('checkout-name')
	if (!(await name.inputValue())) await name.fill('テスト 太郎')
	const phone = page.getByTestId('checkout-phone')
	if (!(await phone.inputValue())) await phone.fill('090-0000-0000')
	await page.getByTestId('checkout-to-payment').click()
	// Stripe.js loads on the first card step, which can take a while.
	await expect(page.getByTestId('checkout-payment')).toBeVisible({
		timeout: 60_000,
	})
}

/** Enter Stripe's test card in the Payment Element and open the hold. */
async function authorizeCard(page: Page): Promise<void> {
	const card = await cardFrame(page)
	await card.locator('input[name="number"]').fill(TEST_CARD.number)
	await card.locator('input[name="expiry"]').fill(TEST_CARD.expiry)
	await card.locator('input[name="cvc"]').fill(TEST_CARD.cvc)
	await page.getByTestId('checkout-authorize').click()
	await expect(page.getByTestId('checkout-confirm')).toBeVisible({
		timeout: 60_000,
	})
}

/**
 * The Payment Element's card frame. Its title is localized, so it is found
 * by the card number input it holds. On a phone the element opens on tabs
 * (card, Google Pay), and the card fields appear once the card tab is chosen.
 */
async function cardFrame(page: Page): Promise<Frame> {
	let found: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if ((await frame.locator('input[name="number"]').count()) > 0) {
						found = frame
						return true
					}
					const cardTab = frame.getByRole('button', { name: /^(カード|Card)$/ })
					if (await cardTab.isVisible().catch(() => false)) {
						await cardTab.click()
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	if (!found) throw new Error('the card frame did not load')
	return found
}
