import { existsSync } from 'node:fs'
import {
	type APIRequestContext,
	type Browser,
	expect,
	type Page,
} from '@playwright/test'
import {
	authorizeCard,
	fillPersonalDetails,
	holdTickets,
	openCheckout,
	stockRow,
} from './checkout'
import { openFreshSale, type SaleStock } from './sale'
import { FAN_STATE, hasOrganizerSession, organizerToken, test } from './session'

/**
 * Story `attribute-a-purchase-to-a-referral-link` on PRODUCTION in Stripe test
 * mode, signed in as the prod E2E test user (`.auth/storageState.prod.json`).
 *
 * Needs a published Event of the test Organizer on which the test user holds
 * no tickets, by id in `E2E_REFERRAL_EVENT_ID`, and the test Organizer's
 * member session (`.auth/storageState.organizer.prod.json`). A run buys 2
 * tickets, so the Event's per-account limit must be at least 2 (Events have
 * 4 unless set otherwise while DRAFT). Each run opens its own sale on a fresh
 * SeatType (as the buy-tickets spec does), and one account holds one seat
 * type per Event, so each run needs an Event the test user holds no tickets
 * for (docs/prod-e2e-fixtures.md). It is not the buy-tickets spec's Event.
 * The run reads the purchases per referral code from the organizer
 * `TicketSaleService.ListByEvent`. Each test buys one ticket after
 * opening the Event page from a link with `?ref=`, and checks that the code's
 * row on the Sales read grew by that Order.
 *
 * The sign-up leg of "Guest from a member's link buys after signing up" is
 * covered by `e2e/functional/referral-link.spec.ts`; "Another tour is not
 * attributed" and "Link older than 7 days" by the checkout and lottery entry
 * route tests.
 *
 * Run it in the pinned Playwright container with the host network:
 *   docker run --rm --network host -e E2E_REFERRAL_EVENT_ID=… \
 *     -v "$PWD":/work -w /work \
 *     mcr.microsoft.com/playwright:v1.64.1-noble \
 *     npx playwright test -c playwright.prod.config.mjs attribute-a-purchase
 */
const EVENT_ID = process.env.E2E_REFERRAL_EVENT_ID ?? ''

/** The fresh stock the run buys from. */
let saleStock: SaleStock = { id: '', seatTypeName: '' }

const ORGANIZER_API_BASE =
	process.env.PROD_ORGANIZER_API_BASE_URL ??
	'https://api.organizer.liverty-music.app'

/** One row of `referral_code_stats` in Connect JSON (zero counts omitted). */
interface WireReferralCodeStats {
	code?: { value: string }
	orderCount?: number
	ticketCount?: number
	amount?: string
}

/** A code's Order and ticket counts on the organizer Sales read now. */
async function statsOf(
	request: APIRequestContext,
	browser: Browser,
	code: string,
): Promise<{ orders: number; tickets: number }> {
	const res = await request.post(
		`${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.ticket_sale.v1.TicketSaleService/ListByEvent`,
		{
			data: { eventId: { value: EVENT_ID } },
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${await organizerToken(browser)}`,
			},
		},
	)
	if (!res.ok()) {
		throw new Error(`ListByEvent failed: ${res.status()} ${await res.text()}`)
	}
	const body = (await res.json()) as {
		referralCodeStats?: WireReferralCodeStats[]
	}
	const row = body.referralCodeStats?.find((r) => r.code?.value === code)
	return { orders: row?.orderCount ?? 0, tickets: row?.ticketCount ?? 0 }
}

/** Open the Event page from a referral link and buy one ticket. */
async function buyOneFromLink(page: Page, code: string): Promise<void> {
	await openCheckout(page, EVENT_ID, saleStock, `?ref=${code}`)
	await holdTickets(page, 1)
	await fillPersonalDetails(page)
	await authorizeCard(page)
	await page.getByTestId('checkout-place-order').click()
	await expect(page.getByTestId('checkout-done')).toBeVisible({
		timeout: 60_000,
	})
}

test.describe.configure({ mode: 'serial' })

test.describe('attribute a purchase to a referral link (signed in)', () => {
	test.beforeAll(async ({ request, browser }) => {
		if (!existsSync(FAN_STATE)) {
			throw new Error(
				`${FAN_STATE} is missing: run npm run auth:capture:password:prod`,
			)
		}
		// Start from an open sale with stock, whatever an earlier run of this or
		// the buy-tickets spec left behind.
		if (EVENT_ID && hasOrganizerSession()) {
			saleStock = await openFreshSale(
				request,
				EVENT_ID,
				await organizerToken(browser),
			)
		}
	})

	test.beforeEach(() => {
		test.skip(!EVENT_ID, 'E2E_REFERRAL_EVENT_ID is required')
		test.skip(
			!hasOrganizerSession(),
			'the organizer member session is required',
		)
	})

	test('counts a purchase under the code of the link', async ({
		page,
		request,
		browser,
	}) => {
		// @spec stories/attribute-a-purchase-to-a-referral-link "Guest from a member's link buys after signing up"
		const before = await statsOf(request, browser, 'e2e-member-a')

		await buyOneFromLink(page, 'e2e-member-a')

		expect(await statsOf(request, browser, 'e2e-member-a')).toEqual({
			orders: before.orders + 1,
			tickets: before.tickets + 1,
		})
	})

	test('counts the next purchase under the last link opened', async ({
		page,
		request,
		browser,
	}) => {
		// @spec stories/attribute-a-purchase-to-a-referral-link "Last link wins"
		const beforeA = await statsOf(request, browser, 'e2e-member-a')
		const beforeB = await statsOf(request, browser, 'e2e-member-b')

		// The fan opens member A's link first, then member B's; the newer
		// link replaces the kept code.
		await page.goto(`/events/${EVENT_ID}?ref=e2e-member-a`)
		await expect(
			stockRow(page, saleStock).getByTestId('event-buy'),
		).toBeVisible()
		await buyOneFromLink(page, 'e2e-member-b')

		expect(await statsOf(request, browser, 'e2e-member-b')).toEqual({
			orders: beforeB.orders + 1,
			tickets: beforeB.tickets + 1,
		})
		expect(await statsOf(request, browser, 'e2e-member-a')).toEqual(beforeA)
	})
})
