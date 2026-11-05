import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { callsOf, connectError, mockFanRpc } from '../support/fan-auth'
import { seedSignedInFan } from '../support/fan-shell'
import { stubStripe } from '../support/stripe'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })

/**
 * Official resale by lottery against a mocked ResaleEntryService and a
 * stand-in for Stripe.js: a fan applies for a sold-out seat type from the
 * event page, sees the application on the event page, and follows and
 * withdraws their entries on the entries screen.
 */

const ENTRY_SPEC = 'components/infrastructure/fan/web/route/resale-entry'
const EVENT_SPEC = 'components/infrastructure/fan/web/route/event'
const EVENT_ID = fakeId('resale-entry-event')
const SALE_ID = fakeId('resale-entry-sale')
// UUIDs: the client validates the ids it sends.
const STOCK_ID = fakeId('resale-entry-stock')
const SEAT_TYPE_ID = fakeId('resale-entry-seat-type')
const ENTRY_ID = fakeId('resale-entry-made')
const ORDER_ID = fakeId('resale-entry-order')
const DAY = 24 * 60 * 60 * 1000

/** The event, 30 days from now. */
function concert() {
	const d = new Date(Date.now() + 30 * DAY)
	return {
		id: { value: EVENT_ID },
		performers: [],
		series: {
			id: { value: fakeId('resale-entry-series') },
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

const stockWire = {
	id: { value: STOCK_ID },
	eventId: { value: EVENT_ID },
	seatTypeId: { value: SEAT_TYPE_ID },
	state: 'TICKET_STOCK_STATE_SOLD_OUT',
	resaleOpen: true,
}

const seatTypeWire = {
	id: { value: SEAT_TYPE_ID },
	name: { value: 'S席' },
	price: { value: '3000' },
}

/** An open first-come sale whose S席 sold out, with its resale open. */
function sales() {
	return {
		ticketSales: [
			{
				id: { value: SALE_ID },
				name: { value: '一般発売' },
				method: 'TICKET_SALE_METHOD_FIRST_COME',
				saleStartTime: new Date(Date.now() - DAY).toISOString(),
				saleEndTime: new Date(Date.now() + 9 * DAY).toISOString(),
				verificationRequirement: 'VERIFICATION_REQUIREMENT_UNSPECIFIED',
				eventIds: [{ value: EVENT_ID }],
			},
		],
		ticketStocks: [stockWire],
		seatTypes: [seatTypeWire],
		perAccountLimit: 4,
	}
}

/** The next 12:00 draw, a day from now. */
const NEXT_DRAW = new Date(Date.now() + DAY)

function entryWire(state: string, extra: Record<string, unknown> = {}) {
	return {
		id: { value: ENTRY_ID },
		orderId: { value: ORDER_ID },
		state,
		createTime: new Date(Date.now() - 60_000).toISOString(),
		...extra,
	}
}

const orderWire = {
	id: { value: ORDER_ID },
	ticketStockId: { value: STOCK_ID },
	ticketCount: 2,
	status: 'ORDER_STATUS_PENDING',
}

/** ResaleEntryService.List's answer with `entries` for the S席 order. */
function listOf(...entries: Record<string, unknown>[]) {
	return {
		resaleEntries: entries,
		orders: [orderWire],
		ticketStocks: [stockWire],
		seatTypes: [seatTypeWire],
	}
}

const waiting = () =>
	entryWire('RESALE_ENTRY_STATE_ENTERED', {
		nextDrawTime: NEXT_DRAW.toISOString(),
	})

/** Mock the backend; `list` answers ResaleEntryService.List each time. */
async function mockBackend(
	page: Page,
	answers: Parameters<typeof mockFanRpc>[1],
) {
	await seedSignedInFan(page, { language: 'ja' })
	await stubStripe(page)
	return mockFanRpc(page, {
		'UserService/Get': {
			user: {
				id: { value: fakeId('resale-entry-fan') },
				email: { value: 'fan@example.com' },
				home: { countryCode: 'JP', level1: 'JP-13' },
				fullName: { value: '山田 花子' },
				phoneNumber: { value: '+819012345678' },
			},
		},
		'ConcertService/Get': concertWire({ concert: concert() }),
		'TicketSaleService/ListByEvent': sales(),
		...answers,
	})
}

test(`@spec ${ENTRY_SPEC} "Applying for two tickets" and @spec ${EVENT_SPEC} "Already applied"`, async ({
	page,
}) => {
	let applied = false
	const calls = await mockBackend(page, {
		'ResaleEntryService/List': () => ({
			body: applied ? listOf(waiting()) : listOf(),
		}),
		'ResaleEntryService/AuthorizeCard': {
			cardAuthorizationId: { value: fakeId('resale-entry-ca') },
			cardAuthorizationSecret: { value: 'pi_e2e_resale_secret_e2e' },
		},
		'ResaleEntryService/Confirm': () => {
			applied = true
			return { body: { resaleEntry: waiting(), order: orderWire } }
		},
	})

	// The sold-out event offers official resale.
	await page.goto(`/events/${EVENT_ID}`)
	const resale = page.getByTestId('event-resale')
	await expect(resale).toBeVisible({ timeout: 30_000 })
	await expect(resale).toContainText('公式リセール')
	await page.getByTestId('event-resale-apply').click()

	// Apply for 2 S席.
	await expect(page.getByTestId('resale-entry-count')).toBeVisible()
	await page.getByTestId('resale-entry-count-select').selectOption('2')
	await page.getByTestId('resale-entry-to-personal-details').click()
	await expect(page.getByTestId('resale-entry-name')).toHaveValue('山田 花子')
	await page.getByTestId('resale-entry-to-payment').click()
	await expect(page.getByTestId('stripe-stub-card')).toBeVisible()
	await expect(page.getByTestId('resale-entry-apply')).toHaveText(
		'6,000円で申し込む',
	)
	await page.getByTestId('resale-entry-apply').click()

	const done = page.getByTestId('resale-entry-done')
	await expect(done).toContainText('申し込みました')
	await expect(page.getByTestId('resale-entry-next-draw')).toContainText(
		'次の抽選：',
	)
	expect(
		callsOf(calls, 'ResaleEntryService/AuthorizeCard').map(
			(c) => c.body.ticketCount,
		),
	).toEqual([2])

	// Back on the event page, the action reads 申し込み済み.
	await page.goto(`/events/${EVENT_ID}`)
	await expect(page.getByTestId('event-resale-applied')).toHaveText(
		'申し込み済み',
		{ timeout: 30_000 },
	)
})

test(`@spec ${ENTRY_SPEC} "Lapsed entry"`, async ({ page }) => {
	await mockBackend(page, {
		'ResaleEntryService/List': listOf(
			entryWire('RESALE_ENTRY_STATE_LAPSED', {
				drawTime: new Date(Date.now() - DAY).toISOString(),
			}),
		),
	})
	await page.goto('/resale-entries')

	const entry = page.getByTestId('resale-entries-entry')
	await expect(entry).toBeVisible({ timeout: 30_000 })
	await expect(page.getByTestId('resale-entries-state')).toHaveText('期限切れ')
	await expect(page.getByTestId('resale-entries-note')).toContainText(
		'請求はありません',
	)
	// The router writes the link as an absolute address.
	await expect(page.getByTestId('resale-entries-apply-again')).toHaveAttribute(
		'href',
		new RegExp(`/events/${EVENT_ID}/resale/${STOCK_ID}$`),
	)
})

test(`@spec ${ENTRY_SPEC} "Withdrawing a waiting entry"`, async ({ page }) => {
	await mockBackend(page, {
		'ResaleEntryService/List': listOf(waiting()),
		'ResaleEntryService/Withdraw': {
			resaleEntry: entryWire('RESALE_ENTRY_STATE_WITHDRAWN', {
				withdrawTime: new Date().toISOString(),
			}),
		},
	})
	await page.goto('/resale-entries')

	await expect(page.getByTestId('resale-entries-state')).toHaveText(
		'抽選待ち',
		{ timeout: 30_000 },
	)
	await page.getByTestId('resale-entries-withdraw').click()
	await expect(
		page.getByTestId('resale-entries-withdraw-confirm'),
	).toContainText('請求はありません')
	await page.getByTestId('resale-entries-withdraw-do').click()

	await expect(page.getByTestId('resale-entries-state')).toHaveText(
		'取り消し済み',
	)
	await expect(page.getByTestId('resale-entries-note')).toContainText(
		'請求はありません',
	)
	await expect(page.getByTestId('resale-entries-apply-again')).toBeVisible()
})

test(`@spec ${ENTRY_SPEC} "Draw decided first"`, async ({ page }) => {
	let decided = false
	await mockBackend(page, {
		'ResaleEntryService/List': () => ({
			body: decided
				? listOf(
						entryWire('RESALE_ENTRY_STATE_WON', {
							drawTime: new Date().toISOString(),
						}),
					)
				: listOf(waiting()),
		}),
		'ResaleEntryService/Withdraw': () => {
			decided = true
			return connectError('failed_precondition', 400)
		},
	})
	await page.goto('/resale-entries')

	await page.getByTestId('resale-entries-withdraw').click({ timeout: 30_000 })
	await page.getByTestId('resale-entries-withdraw-do').click()

	await expect(page.getByTestId('resale-entries-message')).toHaveText(
		'この申し込みは、すでに抽選で結果が決まっています。',
	)
	await expect(page.getByTestId('resale-entries-state')).toHaveText('当選')
})
