import { existsSync } from 'node:fs'
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from '@playwright/test'
import { authorizeCard, fillPersonalDetails, holdTickets } from './checkout'
import { openFreshSale } from './sale'

/**
 * Story `attribute-a-purchase-to-a-referral-link` on PRODUCTION in Stripe test
 * mode, signed in as the prod E2E test user (`.auth/storageState.prod.json`).
 *
 * Needs a published Event of the test Organizer on which the test user can
 * still buy 2 tickets under the per-account limit, by id in
 * `E2E_SALE_EVENT_ID`, and an organizer access token of the test Organizer in
 * `E2E_ORGANIZER_TOKEN`. The run opens its own first-come sale on the event
 * (as the buy-tickets spec does) and reads the purchases per referral code
 * from the organizer `TicketSaleService.ListByEvent`. Each test buys one ticket after
 * opening the Event page from a link with `?ref=`, and checks that the code's
 * row on the Sales read grew by that Order.
 *
 * The sign-up leg of "Guest from a member's link buys after signing up" is
 * covered by `e2e/functional/referral-link.spec.ts`; "Another tour is not
 * attributed" and "Link older than 7 days" by the checkout and lottery entry
 * route tests.
 *
 * Run it in the pinned Playwright container with the host network:
 *   docker run --rm --network host -e E2E_SALE_EVENT_ID=… \
 *     -e E2E_ORGANIZER_TOKEN -v "$PWD":/work -w /work \
 *     mcr.microsoft.com/playwright:v1.63.0-noble \
 *     npx playwright test -c playwright.prod.config.mjs attribute-a-purchase
 */
const SALE_EVENT_ID = process.env.E2E_SALE_EVENT_ID ?? ''
const ORGANIZER_TOKEN = process.env.E2E_ORGANIZER_TOKEN ?? ''

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
	code: string,
): Promise<{ orders: number; tickets: number }> {
	const res = await request.post(
		`${ORGANIZER_API_BASE}/liverty_music.rpc.organizer.ticket_sale.v1.TicketSaleService/ListByEvent`,
		{
			data: { eventId: { value: SALE_EVENT_ID } },
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${ORGANIZER_TOKEN}`,
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
	await page.goto(`/events/${SALE_EVENT_ID}?ref=${code}`)
	await page.getByTestId('event-buy').click()
	await expect(page).toHaveURL(new RegExp(`/events/${SALE_EVENT_ID}/checkout$`))
	await expect(page.getByTestId('checkout-count')).toBeVisible()
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
	test.beforeAll(async ({ request }) => {
		if (!existsSync('.auth/storageState.prod.json')) {
			throw new Error(
				'.auth/storageState.prod.json is missing: run npm run auth:capture:password:prod',
			)
		}
		// Start from an open sale with stock, whatever an earlier run of this or
		// the buy-tickets spec left behind.
		if (SALE_EVENT_ID && ORGANIZER_TOKEN) {
			await openFreshSale(request, SALE_EVENT_ID, ORGANIZER_TOKEN)
		}
	})

	test.beforeEach(() => {
		test.skip(!SALE_EVENT_ID, 'E2E_SALE_EVENT_ID is required')
		test.skip(!ORGANIZER_TOKEN, 'E2E_ORGANIZER_TOKEN is required')
	})

	test('counts a purchase under the code of the link', async ({
		page,
		request,
	}) => {
		// @spec stories/attribute-a-purchase-to-a-referral-link "Guest from a member's link buys after signing up"
		const before = await statsOf(request, 'e2e-member-a')

		await buyOneFromLink(page, 'e2e-member-a')

		expect(await statsOf(request, 'e2e-member-a')).toEqual({
			orders: before.orders + 1,
			tickets: before.tickets + 1,
		})
	})

	test('counts the next purchase under the last link opened', async ({
		page,
		request,
	}) => {
		// @spec stories/attribute-a-purchase-to-a-referral-link "Last link wins"
		const beforeA = await statsOf(request, 'e2e-member-a')
		const beforeB = await statsOf(request, 'e2e-member-b')

		// The fan opens member A's link first, then member B's; the newer
		// link replaces the kept code.
		await page.goto(`/events/${SALE_EVENT_ID}?ref=e2e-member-a`)
		await expect(page.getByTestId('event-buy')).toBeVisible()
		await buyOneFromLink(page, 'e2e-member-b')

		expect(await statsOf(request, 'e2e-member-b')).toEqual({
			orders: beforeB.orders + 1,
			tickets: beforeB.tickets + 1,
		})
		expect(await statsOf(request, 'e2e-member-a')).toEqual(beforeA)
	})
})
