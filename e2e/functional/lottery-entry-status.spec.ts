import { fakeId } from '../support/fake-id'
import { FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { seedSignedInFan } from '../support/fan-shell'
import { expect, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })
test.use({ locale: 'en-US', viewport: { width: 390, height: 844 } })

/**
 * The fan's lottery entry status screen against a mocked
 * LotteryEntryService.ListByTicketType: an Entered entry waits for the draw,
 * Won and Lost show their result, and no state offers an action on the entry
 * (a confirmed entry cannot be withdrawn).
 */

const EVENT_ID = fakeId('lottery-entry-status-event')
const TICKET_TYPE_ID = fakeId('lottery-entry-status-ticket-type')

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
			'LotteryEntryService/ListByTicketType': {
				lotteryEntries: [
					{
						id: { value: fakeId(`lottery-entry-status-${state}`) },
						ticketTypeId: { value: TICKET_TYPE_ID },
						ticketCount: 2,
						state,
					},
				],
			},
		})

		await page.goto(`/events/${EVENT_ID}/lottery/${TICKET_TYPE_ID}/entry`)
		const entry = page.getByTestId('lottery-entry-status-entry')
		await expect(entry).toBeVisible({ timeout: 30_000 })

		await expect(entry.locator('output')).toHaveText(label)
		await expect(entry).toContainText(note)
		await expect(entry).toContainText('Tickets')
		await expect(entry.getByRole('button')).toHaveCount(0)
		await expect(page.getByText(/withdraw/i)).toHaveCount(0)
	})
}
