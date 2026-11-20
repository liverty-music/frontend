import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { callsOf, connectError, mockFanRpc } from '../support/fan-auth'
import { seedSignedInFan } from '../support/fan-shell'
import { stripeClientSecrets, stubStripe } from '../support/stripe'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

/**
 * The fan's lottery entry screen against a mocked LotteryEntryService and a
 * stand-in for Stripe.js: AuthorizeCard opens a card authorization for the
 * chosen count, the card is authenticated, and Confirm makes the entry. No
 * entry exists before Confirm, so a count changed after authorizing is
 * authorized anew.
 */

const SPEC = 'components/infrastructure/fan/web/route/lottery-entry'
const EVENT_ID = fakeId('lottery-entry-event')
const SALE_ID = fakeId('lottery-entry-sale')
// UUIDs: the client validates the ids it sends.
const STOCK_ID = fakeId('lottery-entry-stock')
const SEAT_TYPE_ID = fakeId('lottery-entry-seat-type')

function concert() {
	const d = new Date()
	d.setDate(d.getDate() + 30)
	return {
		id: { value: EVENT_ID },
		performers: [],
		series: {
			id: { value: fakeId('lottery-entry-series') },
			title: { value: 'XX Tour 2026' },
			publishState: 'PUBLISH_STATE_PUBLISHED',
		},
		localDate: {
			value: {
				year: d.getFullYear(),
				month: d.getMonth() + 1,
				day: d.getDate(),
			},
		},
		listedVenueName: { value: 'Zepp Haneda' },
	}
}

/** The ファンクラブ先行 lottery, open for another 9 days, 8000 yen. */
function sales() {
	const day = 24 * 60 * 60 * 1000
	return {
		ticketSales: [
			{
				id: { value: SALE_ID },
				name: { value: 'ファンクラブ先行' },
				method: 'TICKET_SALE_METHOD_LOTTERY',
				saleStartTime: new Date(Date.now() - day).toISOString(),
				saleEndTime: new Date(Date.now() + 9 * day).toISOString(),
				verificationRequirement: 'VERIFICATION_REQUIREMENT_UNSPECIFIED',
				eventIds: [{ value: EVENT_ID }],
			},
		],
		ticketStocks: [
			{
				id: { value: STOCK_ID },
				eventId: { value: EVENT_ID },
				seatTypeId: { value: SEAT_TYPE_ID },
				state: 'TICKET_STOCK_STATE_AVAILABLE',
			},
		],
		seatTypes: [
			{
				id: { value: SEAT_TYPE_ID },
				name: { value: 'S席' },
				price: { value: '8000' },
			},
		],
		perAccountLimit: 4,
	}
}

/** The card authorization AuthorizeCard opens for `count` tickets. */
const cardAuthorizationId = (count: number) => `pi_e2e_${count}`

/** Open the entry screen against the mocked backend; returns the RPC calls. */
async function openEntry(
	page: Page,
	confirm: Parameters<typeof mockFanRpc>[1][string],
) {
	await seedSignedInFan(page, { language: 'en' })
	await stubStripe(page)
	const calls = await mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: fakeId('lottery-entry-fan') },
				email: { value: 'fan@example.com' },
				home: { countryCode: 'JP', level1: 'JP-13' },
				fullName: { value: '山田 花子' },
				phoneNumber: { value: '+819012345678' },
			},
		},
		'ConcertService/Get': concertWire({ concert: concert() }),
		'TicketSaleService/ListByEvent': sales(),
		'LotteryEntryService/AuthorizeCard': (body) => {
			const count = Number(body.ticketCount)
			return {
				body: {
					cardAuthorizationId: { value: cardAuthorizationId(count) },
					cardAuthorizationSecret: {
						value: `${cardAuthorizationId(count)}_secret_e2e`,
					},
				},
			}
		},
		'LotteryEntryService/Confirm': confirm,
	})
	await page.goto(`/events/${EVENT_ID}/lottery/${SALE_ID}/${STOCK_ID}`)
	await expect(page.getByTestId('lottery-entry-count')).toBeVisible({
		timeout: 30_000,
	})
	return calls
}

/** From the count step to the card form, for `count` tickets. */
async function authorize(page: Page, count: number): Promise<void> {
	await page.getByTestId('lottery-entry-count-select').selectOption(`${count}`)
	await page.getByTestId('lottery-entry-to-personal-details').click()
	await expect(page.getByTestId('lottery-entry-name')).toHaveValue('山田 花子')
	await page.getByTestId('lottery-entry-to-payment').click()
	await expect(page.getByTestId('stripe-stub-card')).toBeVisible()
}

/** Confirm answers the Entered entry the card authorization makes. */
const confirmEntered = (body: Record<string, unknown>) => {
	const id = (body.cardAuthorizationId as { value: string }).value
	return {
		body: {
			lotteryEntry: {
				id: { value: fakeId('lottery-entry-made') },
				orderId: { value: fakeId('lottery-entry-order') },
				ticketSaleId: { value: SALE_ID },
				state: 'LOTTERY_ENTRY_STATE_ENTERED',
			},
			order: {
				id: { value: fakeId('lottery-entry-order') },
				ticketStockId: { value: STOCK_ID },
				ticketCount: Number(id.replace('pi_e2e_', '')),
				status: 'ORDER_STATUS_PENDING',
			},
		},
	}
}

test(`@spec ${SPEC} "Count changed after authorizing"`, async ({ page }) => {
	const calls = await openEntry(page, confirmEntered)

	await authorize(page, 2)
	await expect(page.getByTestId('lottery-entry-payment')).toContainText(
		'¥16,000',
	)

	// Back to the count, and 3 tickets instead.
	await page.getByTestId('lottery-entry-back-to-personal-details').click()
	await page.getByRole('button', { name: 'Back' }).click()
	await authorize(page, 3)
	await expect(page.getByTestId('lottery-entry-payment')).toContainText(
		'¥24,000',
	)
	await page.getByTestId('lottery-entry-confirm').click()

	const done = page.getByTestId('lottery-entry-done')
	await expect(done).toBeVisible()
	await expect(done).toContainText('for 3 tickets')

	const authorizeCalls = callsOf(calls, 'LotteryEntryService/AuthorizeCard')
	expect(authorizeCalls.map((c) => c.body.ticketCount)).toEqual([2, 3])
	expect(authorizeCalls[0].body.fullName).toEqual({ value: '山田 花子' })
	expect(authorizeCalls[0].body.phoneNumber).toEqual({
		value: '+819012345678',
	})
	expect(await stripeClientSecrets(page)).toEqual([
		'pi_e2e_2_secret_e2e',
		'pi_e2e_3_secret_e2e',
	])
	expect(
		callsOf(calls, 'LotteryEntryService/Confirm').map((c) => c.body),
	).toEqual([{ cardAuthorizationId: { value: cardAuthorizationId(3) } }])
	expect(callsOf(calls, 'LotteryEntryService/Start')).toHaveLength(0)
})

test(`@spec ${SPEC} "Window closed while confirming"`, async ({ page }) => {
	await openEntry(page, () => connectError('failed_precondition', 400))
	await authorize(page, 2)

	// The end time passes while the fan authenticates the card.
	await page.clock.setFixedTime(Date.now() + 10 * 24 * 60 * 60 * 1000)
	await page.getByTestId('lottery-entry-confirm').click()

	const refused = page.getByTestId('lottery-entry-refused')
	await expect(refused).toBeVisible()
	await expect(refused).toContainText('Your entry was not made')
	await expect(refused).toContainText(
		'The entry window for this lottery has closed.',
	)
	await expect(refused).toContainText(
		'Nothing will be charged to your card for this entry.',
	)
	await expect(page.getByTestId('lottery-entry-done')).toHaveCount(0)
})
