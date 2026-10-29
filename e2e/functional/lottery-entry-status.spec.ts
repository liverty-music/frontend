import { fakeId } from '../support/fake-id'
import { FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { seedSignedInFan } from '../support/fan-shell'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

/**
 * The fan's lottery entry status screen against a mocked
 * LotteryEntryService.ListByTicketSale (the fan's entries in a sale, with their
 * Orders) and TicketSaleService.ListByEvent (the event's stocks): an Entered
 * entry waits for the draw,
 * Won and Lost show their result, and no state offers an action on the entry
 * (a confirmed entry cannot be withdrawn).
 */

const EVENT_ID = fakeId('lottery-entry-status-event')
const SALE_ID = fakeId('lottery-entry-status-sale')
const STOCK_ID = fakeId('lottery-entry-status-stock')
const SEAT_TYPE_ID = fakeId('lottery-entry-status-seat-type')

const cases = [
	{
		state: 'LOTTERY_ENTRY_STATE_ENTERED',
		label: 'Awaiting the draw',
		note: 'Please wait for the draw result.',
	},
	{
		state: 'LOTTERY_ENTRY_STATE_WON',
		label: 'Won',
		note: 'You won.',
	},
	{
		state: 'LOTTERY_ENTRY_STATE_LOST',
		label: 'Not won',
		note: 'You did not win this time.',
	},
] as const

for (const { state, label, note } of cases) {
	test(`shows a ${state} entry with no action on it`, async ({ page }) => {
		await seedSignedInFan(page, { language: 'en' })
		await mockFanRpc(page, {
			'UserService/Get': {
				user: {
					id: { value: FAN_SUB },
					email: { value: FAN_EMAIL },
					home: { countryCode: 'JP', level1: 'JP-13' },
				},
			},
			'LotteryEntryService/ListByTicketSale': {
				lotteryEntries: [
					{
						id: { value: fakeId(`lottery-entry-status-${state}`) },
						orderId: { value: fakeId('lottery-entry-status-order') },
						ticketSaleId: { value: SALE_ID },
						state,
					},
				],
				orders: [
					{
						id: { value: fakeId('lottery-entry-status-order') },
						ticketStockId: { value: STOCK_ID },
						ticketCount: 2,
					},
				],
			},
			'TicketSaleService/ListByEvent': {
				ticketStocks: [
					{
						id: { value: STOCK_ID },
						eventId: { value: EVENT_ID },
						seatTypeId: { value: SEAT_TYPE_ID },
						state: 'TICKET_STOCK_STATE_SOLD_OUT',
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
			},
		})

		await page.goto(`/events/${EVENT_ID}/lottery/${SALE_ID}/${STOCK_ID}/entry`)
		const entry = page.getByTestId('lottery-entry-status-entry')
		await expect(entry).toBeVisible({ timeout: 30_000 })

		await expect(entry.locator('output')).toHaveText(label)
		await expect(entry).toContainText(note)
		await expect(entry).toContainText('Tickets')
		await expect(page.getByTestId('lottery-entry-status-seat-type')).toHaveText(
			'S席',
		)
		await expect(entry.getByRole('button')).toHaveCount(0)
		await expect(page.getByText(/withdraw/i)).toHaveCount(0)
	})
}
