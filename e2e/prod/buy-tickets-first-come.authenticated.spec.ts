import { existsSync } from 'node:fs'
import {
	type APIRequestContext,
	expect,
	type Frame,
	type Page,
	test,
} from '@playwright/test'

/**
 * Story `buy-tickets-first-come` on PRODUCTION in Stripe test mode, signed in
 * as the prod E2E test user (`.auth/storageState.prod.json`).
 *
 * Needs a published Event of the test Organizer with a first-come sale, by id
 * in `E2E_SALE_EVENT_ID`. The tests run in order and share the sale:
 *   1. Two tickets bought: 2 sold.
 *   2. Double tap everywhere: 1 sold.
 *   3. Hold ran out: nothing sold (waits out a 15-minute hold).
 *   4. Fan closes the tab: holds every remaining ticket, then waits out the
 *      hold (waits 16 minutes).
 * A sale of 5 tickets, at any price, with a per-account limit of 10 leaves exactly 2 for
 * the fourth test, so its hold makes the sale AllHeld. Each run needs a fresh
 * sale, because the test user's purchases count against the limit.
 *
 * Run it in the pinned Playwright container with the host network, which
 * keeps js.stripe.com reachable from inside it:
 *   docker run --rm --network host -e E2E_SALE_EVENT_ID=… -v "$PWD":/work \
 *     -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
 *     npx playwright test -c playwright.prod.config.mjs buy-tickets-first-come
 *
 * What a browser cannot see is checked separately against production:
 * one confirmation email per Order (`orders.confirmation_sent_at`), the card
 * hold released after an ended hold (`reservations.authorization_released_at`
 * and the PaymentIntent canceled), and the ticket journey Paid.
 */
const SALE_EVENT_ID = process.env.E2E_SALE_EVENT_ID ?? ''

/** Stripe's test card that authorizes without 3D Secure. */
const TEST_CARD = { number: '4242424242424242', expiry: '12 / 34', cvc: '123' }

/** The checkout's 15-minute hold, plus a margin for the server's clock. */
const HOLD_MS = 15 * 60 * 1000
const MARGIN_MS = 60 * 1000

const API_BASE =
	process.env.PROD_API_BASE_URL ?? 'https://api.liverty-music.app'

/** The sale's price of one ticket in yen, read as a guest. */
async function salePrice(request: APIRequestContext): Promise<number> {
	const res = await request.post(
		`${API_BASE}/liverty_music.rpc.ticket_sale.v1.TicketSaleService/Get`,
		{
			data: { eventId: { value: SALE_EVENT_ID } },
			headers: { 'content-type': 'application/json' },
		},
	)
	expect(res.ok()).toBe(true)
	const body = (await res.json()) as { ticketSale: { price: string } }
	return Number(body.ticketSale.price)
}

/** A yen amount as the checkout writes it, e.g. "6,000". */
const yen = (n: number) => n.toLocaleString('ja-JP')

test.describe.configure({ mode: 'serial' })

test.describe('buy tickets first come (signed in)', () => {
	test.beforeAll(() => {
		if (!existsSync('.auth/storageState.prod.json')) {
			throw new Error(
				'.auth/storageState.prod.json is missing: run npm run auth:capture:password:prod',
			)
		}
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
		const started = page.waitForResponse(/ReservationService\/Start$/)
		await page.getByTestId('checkout-hold').dblclick()
		const start = (await (await started).json()) as {
			reservation: { id: { value: string } }
		}
		await expect(page.getByTestId('checkout-identity')).toBeVisible()
		await fillIdentity(page)
		await authorizeCard(page)

		const confirmed = page.waitForResponse(/ReservationService\/Confirm$/)
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
			`${API_BASE}/liverty_music.rpc.reservation.v1.ReservationService/Confirm`,
			{
				data: { reservationId: { value: start.reservation.id.value } },
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
})

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
