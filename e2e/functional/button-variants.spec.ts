import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { FAN_EMAIL, FAN_SUB, mockFanRpc } from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

// The first page load compiles the app on the dev server; allow for it.
test.describe.configure({ timeout: 60_000 })

/**
 * The fan app's shared text button (`src/styles/button.css`) picks its look
 * from `data-variant`: a destructive action is `danger`, a secondary or
 * dismissive one `outlined`. These checks open real routes against a mocked
 * backend and read the variant the rendered button carries.
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/ui-primitives'
const EVENT_ID = fakeId('button-variants-event')
const TICKET_TYPE_ID = fakeId('button-variants-ticket-type')
const USER = {
	user: {
		id: { value: FAN_SUB },
		email: { value: FAN_EMAIL },
		home: { countryCode: 'JP', level1: 'JP-13' },
	},
}

test.use({ locale: 'en-US' })

/** Boot signed in, with the prompts that could cover the page dismissed. */
async function seedSignedIn(page: Page): Promise<void> {
	await page.context().addInitScript(
		({ sub, email }) => {
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('ui.notificationPromptDismissed', 'true')
			localStorage.setItem('pwa.installed', 'true')
			localStorage.setItem(
				'oidc.user:https://auth.dev.liverty-music.app:371355407710421859',
				JSON.stringify({
					id_token: 'fake-id-token',
					access_token: 'fake-access-token',
					token_type: 'Bearer',
					scope: 'openid profile email',
					profile: { sub, email },
					expires_at: 9999999999,
				}),
			)
		},
		{ sub: FAN_SUB, email: FAN_EMAIL },
	)
}

function concert() {
	const d = new Date()
	d.setDate(d.getDate() + 30)
	return {
		id: { value: EVENT_ID },
		performers: [
			{
				id: { value: fakeId('button-variants-artist') },
				name: { value: 'The Band' },
				mbid: { value: '' },
			},
		],
		series: {
			id: { value: fakeId('button-variants-series') },
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
		venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
	}
}

test(`@spec ${CAPABILITY} "Destructive action"`, async ({ page }) => {
	await seedSignedIn(page)
	await mockFanRpc(page, {
		'UserService/Get': USER,
		'LotteryEntryService/ListByTicketType': {
			lotteryEntries: [
				{
					id: { value: fakeId('button-variants-entry') },
					ticketTypeId: { value: TICKET_TYPE_ID },
					ticketCount: 2,
					state: 'LOTTERY_ENTRY_STATE_ENTERED',
				},
			],
		},
	})

	await page.goto(`/events/${EVENT_ID}/lottery/${TICKET_TYPE_ID}/entry`)
	await expect(page.getByTestId('lottery-entry-status-entry')).toBeVisible({
		timeout: 30_000,
	})

	// The action that opens the withdraw confirmation is itself dismissible
	// until confirmed, so it is outlined; the confirming action is destructive.
	await page.getByRole('button', { name: 'Withdraw my entry' }).click()
	const withdraw = page.getByRole('button', { name: 'Withdraw', exact: true })
	await expect(withdraw).toHaveClass(/\bbutton\b/)
	await expect(withdraw).toHaveAttribute('data-variant', 'danger')
	await expect(
		page.getByRole('button', { name: 'Keep my entry' }),
	).toHaveAttribute('data-variant', 'outlined')
})

test(`@spec ${CAPABILITY} "Secondary and dismissive actions are outlined"`, async ({
	page,
}) => {
	await seedSignedIn(page)
	await mockFanRpc(page, {
		'UserService/Get': USER,
		'ConcertService/Get': concertWire({ concert: concert() }),
		'ConcertService/ListBySeries': concertWire({ concerts: [concert()] }),
	})

	await page.goto(`/events/${EVENT_ID}`)
	const share = page.getByTestId('event-share')
	await expect(share).toBeVisible({ timeout: 30_000 })
	await expect(share).toHaveClass(/\bbutton\b/)
	await expect(share).toHaveAttribute('data-variant', 'outlined')
	await expect(page.getByTestId('event-calendar')).toHaveAttribute(
		'data-variant',
		'outlined',
	)
})
