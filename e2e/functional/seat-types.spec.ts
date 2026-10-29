import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { callsOf, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { seedSignedInFan } from '../support/fan-shell'
import { stubStripe } from '../support/stripe'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 90_000 })
test.use({ locale: 'ja-JP', viewport: { width: 390, height: 844 } })

/**
 * A fan picks one seat type (席種) of an event against a mocked backend and a
 * stand-in for Stripe.js (OpenSpec change `remodel-ticket-sales`, task 9.2):
 * the event page lists each stock of the event from
 * TicketSaleService.ListByEvent, and once the fan holds tickets of one seat
 * type it offers only that one. A lottery sale of two dates takes one entry
 * per date.
 */

const EVENT_SPEC = 'components/infrastructure/fan/web/route/event'
const STORY_SPEC = 'stories/win-tickets-in-a-lottery'

const SERIES_ID = fakeId('seat-types-series')
const DAY = 24 * 60 * 60 * 1000

function concert(eventId: string, daysAhead: number) {
	const d = new Date(Date.now() + daysAhead * DAY)
	return {
		id: { value: eventId },
		performers: [],
		series: {
			id: { value: SERIES_ID },
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

/** A sale (wire shape) open from yesterday for 9 more days. */
function sale(
	id: string,
	name: string,
	method: 'FIRST_COME' | 'LOTTERY',
	eventIds: string[],
) {
	return {
		id: { value: id },
		name: { value: name },
		method: `TICKET_SALE_METHOD_${method}`,
		seriesId: { value: SERIES_ID },
		saleStartTime: new Date(Date.now() - DAY).toISOString(),
		saleEndTime: new Date(Date.now() + 9 * DAY).toISOString(),
		eventIds: eventIds.map((value) => ({ value })),
	}
}

const seatType = (id: string, name: string, price: number) => ({
	id: { value: id },
	seriesId: { value: SERIES_ID },
	name: { value: name },
	price: { value: String(price) },
})

const stock = (id: string, eventId: string, seatTypeId: string) => ({
	id: { value: id },
	eventId: { value: eventId },
	seatTypeId: { value: seatTypeId },
	state: 'TICKET_STOCK_STATE_AVAILABLE',
})

const S_SEAT = fakeId('seat-type-s')
const A_SEAT = fakeId('seat-type-a')
const SEAT_TYPES = [
	seatType(S_SEAT, 'S席', 8000),
	seatType(A_SEAT, 'A席', 6000),
]

const FAN_USER = {
	user: {
		id: { value: FAN_SUB },
		email: { value: 'fan@example.com' },
		home: { countryCode: 'JP', level1: 'JP-13' },
		fullName: { value: '山田 花子' },
		phoneNumber: { value: '+819012345678' },
	},
}

/** The actions to buy or to enter, per seat type row of the ticket section. */
async function offeredSeatTypes(page: Page, action: string): Promise<string[]> {
	const rows = page.getByTestId('event-stock')
	await expect(rows.first()).toBeVisible({ timeout: 30_000 })
	const names: string[] = []
	for (const row of await rows.all()) {
		if ((await row.getByTestId(action).count()) > 0) {
			names.push(
				(await row.getByTestId('event-stock-name').textContent())?.trim() ?? '',
			)
		}
	}
	return names
}

test(`@spec ${EVENT_SPEC} "Fan already holds another seat type" — buys 2 A席 first come, then only A席 is offered`, async ({
	page,
}) => {
	const eventId = fakeId('seat-types-event')
	const saleId = fakeId('seat-types-general-sale')
	const sStock = fakeId('seat-types-stock-s')
	const aStock = fakeId('seat-types-stock-a')
	const checkoutId = fakeId('seat-types-checkout')
	const orderId = fakeId('seat-types-order')
	const holdExpire = new Date(Date.now() + 15 * 60 * 1000).toISOString()
	// What the backend knows of the fan: nothing until the order is placed.
	let paid = false

	const order = (status: string) => ({
		id: { value: orderId },
		userId: { value: FAN_SUB },
		ticketStockId: { value: aStock },
		ticketCount: 2,
		checkoutId: { value: checkoutId },
		payment: { provider: 'PAYMENT_PROVIDER_STRIPE' },
		status,
		amount: '12000',
		currency: 'JPY',
	})
	const checkout = (status: string) => ({
		id: { value: checkoutId },
		orderId: { value: orderId },
		ticketSaleId: { value: saleId },
		status,
		holdExpireTime: holdExpire,
	})

	await seedSignedInFan(page, { language: 'ja' })
	await stubStripe(page)
	const calls = await mockFanRpc(page, {
		'UserService/Get': FAN_USER,
		'ConcertService/Get': concertWire({ concert: concert(eventId, 30) }),
		'TicketSaleService/ListByEvent': {
			ticketSales: [sale(saleId, '一般発売', 'FIRST_COME', [eventId])],
			ticketStocks: [
				stock(sStock, eventId, S_SEAT),
				stock(aStock, eventId, A_SEAT),
			],
			seatTypes: SEAT_TYPES,
			perAccountLimit: 4,
		},
		'TicketService/List': () => ({
			body: {
				tickets: paid
					? [1, 2].map((i) => ({
							id: { value: fakeId(`seat-types-ticket-${i}`) },
							orderId: { value: orderId },
							userId: { value: FAN_SUB },
							eventId: { value: eventId },
							resaleWithoutConsentProhibited: true,
							status: 'TICKET_STATUS_ISSUED',
							issueTime: new Date().toISOString(),
						}))
					: [],
			},
		}),
		'OrderService/Get': () => ({
			body: {
				order: order(paid ? 'ORDER_STATUS_PAID' : 'ORDER_STATUS_PENDING'),
			},
		}),
		'CheckoutService/Start': {
			checkout: checkout('CHECKOUT_STATUS_HELD'),
			order: order('ORDER_STATUS_PENDING'),
		},
		'CheckoutService/Get': () => ({
			body: {
				checkout: checkout(
					paid ? 'CHECKOUT_STATUS_COMPLETED' : 'CHECKOUT_STATUS_HELD',
				),
				order: order(paid ? 'ORDER_STATUS_PAID' : 'ORDER_STATUS_PENDING'),
			},
		}),
		'CheckoutService/AuthorizeCard': {
			cardAuthorizationSecret: { value: 'pi_e2e_checkout_secret_e2e' },
		},
		'CheckoutService/Confirm': () => {
			paid = true
			return { body: { order: order('ORDER_STATUS_PAID') } }
		},
	})

	// Both seat types are offered before the fan buys.
	await page.goto(`/events/${eventId}`)
	expect(await offeredSeatTypes(page, 'event-buy')).toEqual(['S席', 'A席'])

	// Pick A席 and buy 2.
	const aRow = page
		.getByTestId('event-stock')
		.filter({ has: page.getByText('A席', { exact: true }) })
	await aRow.getByTestId('event-buy').click()
	await expect(page).toHaveURL(`/events/${eventId}/checkout/${aStock}`)
	await expect(page.getByTestId('checkout-seat-type')).toHaveText('A席', {
		timeout: 30_000,
	})
	await page.getByTestId('checkout-count-select').selectOption('2')
	await expect(page.getByTestId('checkout-total')).toHaveText(
		'合計 12,000円（税込）',
	)
	await page.getByTestId('checkout-hold').click()
	await expect(page.getByTestId('checkout-name')).toHaveValue('山田 花子')
	await page.getByTestId('checkout-to-payment').click()
	await expect(page.getByTestId('stripe-stub-card')).toBeVisible()
	await page.getByTestId('checkout-authorize-card').click()
	await expect(page.getByTestId('checkout-confirm-tickets')).toHaveText(
		'A席 2枚 × 6,000円 = 合計 12,000円（税込）',
	)
	await page.getByTestId('checkout-place-order').click()
	await expect(page.getByTestId('checkout-done')).toBeVisible()

	expect(callsOf(calls, 'CheckoutService/Start').map((c) => c.body)).toEqual([
		{ ticketStockId: { value: aStock }, ticketCount: 2 },
	])
	expect(callsOf(calls, 'CheckoutService/Confirm')).toHaveLength(1)

	// Reopen the event: only A席 is offered, and the section says why.
	await page.goto(`/events/${eventId}`)
	await expect(page.getByTestId('event-sale-held')).toContainText(
		'この日程でお持ちのチケットはA席です',
		{ timeout: 30_000 },
	)
	expect(await offeredSeatTypes(page, 'event-buy')).toEqual(['A席'])
	await expect(page.getByTestId('event-purchased')).toContainText('2枚購入済み')
})

test(`@spec ${STORY_SPEC} "Second entry into the same sale" — a two-date lottery takes one entry per date`, async ({
	page,
}) => {
	const day1 = fakeId('seat-types-tour-day-1')
	const day2 = fakeId('seat-types-tour-day-2')
	const saleId = fakeId('seat-types-tour-presale')
	const stocks: Record<string, string> = {
		[day1]: fakeId('seat-types-tour-day-1-s'),
		[day2]: fakeId('seat-types-tour-day-2-s'),
	}
	const entries: { stock: string; count: number }[] = []
	const tourSale = sale(saleId, 'ファンクラブ先行', 'LOTTERY', [day1, day2])

	await seedSignedInFan(page, { language: 'ja' })
	await stubStripe(page)
	const calls = await mockFanRpc(page, {
		'UserService/Get': FAN_USER,
		'ConcertService/Get': (body) => {
			const id = (body.eventId as { value: string }).value
			return {
				body: concertWire({ concert: concert(id, id === day1 ? 30 : 31) }),
			}
		},
		// Each date returns the shared sale with only its own stock.
		'TicketSaleService/ListByEvent': (body) => {
			const id = (body.eventId as { value: string }).value
			return {
				body: {
					ticketSales: [tourSale],
					ticketStocks: [stock(stocks[id], id, S_SEAT)],
					seatTypes: SEAT_TYPES,
					perAccountLimit: 4,
				},
			}
		},
		'TicketService/List': { tickets: [] },
		'LotteryEntryService/AuthorizeCard': (body) => {
			const stockId = (body.ticketStockId as { value: string }).value
			entries.push({ stock: stockId, count: Number(body.ticketCount) })
			const id = `pi_e2e_${entries.length}`
			return {
				body: {
					cardAuthorizationId: { value: id },
					cardAuthorizationSecret: { value: `${id}_secret_e2e` },
				},
			}
		},
		'LotteryEntryService/Confirm': (body) => {
			const id = (body.cardAuthorizationId as { value: string }).value
			const n = Number(id.replace('pi_e2e_', ''))
			const entry = entries[n - 1]
			return {
				body: {
					lotteryEntry: {
						id: { value: fakeId(`seat-types-entry-${n}`) },
						orderId: { value: fakeId(`seat-types-entry-order-${n}`) },
						ticketSaleId: { value: saleId },
						state: 'LOTTERY_ENTRY_STATE_ENTERED',
					},
					order: {
						id: { value: fakeId(`seat-types-entry-order-${n}`) },
						ticketStockId: { value: entry.stock },
						ticketCount: entry.count,
						status: 'ORDER_STATUS_PENDING',
					},
				},
			}
		},
		// The fan's entries in the sale so far, each with its Order.
		'LotteryEntryService/ListByTicketType': () => ({
			body: {
				lotteryEntries: entries.map((_, i) => ({
					id: { value: fakeId(`seat-types-entry-${i + 1}`) },
					orderId: { value: fakeId(`seat-types-entry-order-${i + 1}`) },
					ticketSaleId: { value: saleId },
					state: 'LOTTERY_ENTRY_STATE_ENTERED',
				})),
				orders: entries.map((e, i) => ({
					id: { value: fakeId(`seat-types-entry-order-${i + 1}`) },
					ticketStockId: { value: e.stock },
					ticketCount: e.count,
					status: 'ORDER_STATUS_PENDING',
				})),
			},
		}),
	})

	/** Enter the lottery for 2 tickets of the date's S席 from its event page. */
	async function enter(eventId: string): Promise<void> {
		await page.goto(`/events/${eventId}`)
		expect(await offeredSeatTypes(page, 'event-enter')).toEqual(['S席'])
		await page.getByTestId('event-enter').click()
		await expect(page).toHaveURL(
			`/events/${eventId}/lottery/${saleId}/${stocks[eventId]}`,
		)
		await expect(page.getByTestId('lottery-entry-seat-type')).toHaveText(
			'S席',
			{ timeout: 30_000 },
		)
		await page.getByTestId('lottery-entry-count-select').selectOption('2')
		await page.getByTestId('lottery-entry-to-personal-details').click()
		await expect(page.getByTestId('lottery-entry-name')).toHaveValue(
			'山田 花子',
		)
		await page.getByTestId('lottery-entry-to-payment').click()
		await expect(page.getByTestId('stripe-stub-card')).toBeVisible()
		await page.getByTestId('lottery-entry-confirm').click()
		await expect(page.getByTestId('lottery-entry-done')).toContainText(
			'ファンクラブ先行に2枚で申し込みました',
		)
	}

	await enter(day1)
	// The entry for the first date does not stop an entry for the second.
	await enter(day2)

	expect(
		callsOf(calls, 'LotteryEntryService/AuthorizeCard').map((c) => [
			c.body.ticketSaleId,
			c.body.ticketStockId,
			c.body.ticketCount,
		]),
	).toEqual([
		[{ value: saleId }, { value: stocks[day1] }, 2],
		[{ value: saleId }, { value: stocks[day2] }, 2],
	])
	expect(callsOf(calls, 'LotteryEntryService/Confirm')).toHaveLength(2)
})
