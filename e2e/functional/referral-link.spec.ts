import { concertWire } from '../support/concert-wire'
import { fakeId } from '../support/fake-id'
import { mockIdentityProvider } from '../support/fan-auth'
import { expect, type Page, test } from '../support/test'

/**
 * A referral link's code is kept on the device through the sign-up round trip
 * (OpenSpec `referral-attribution`, design D7). The backend and the identity
 * provider are mocked: the authorize request is answered with a redirect back
 * to the app's callback, and the token endpoint with an unsigned ID token
 * (oidc-client-ts does not verify signatures).
 */

const EVENT_ID = fakeId('referral-event')
const SERIES_ID = fakeId('referral-series')
const USER_ID = '00000000-0000-4000-8000-d00000000002'

function concert() {
	const d = new Date()
	d.setDate(d.getDate() + 30)
	return {
		id: { value: EVENT_ID },
		performers: [
			{
				id: { value: fakeId('referral-artist') },
				name: { value: 'The Band' },
				mbid: { value: '' },
			},
		],
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
		venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
	}
}

async function mockBackend(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(body),
			})
		if (url.includes('ConcertService/Get')) {
			return json(concertWire({ concert: concert() }))
		}
		if (url.includes('ConcertService/ListBySeries')) {
			return json(concertWire({ concerts: [concert()] }))
		}
		if (url.includes('UserService/')) {
			return json({
				user: {
					id: { value: USER_ID },
					email: { value: 'fan@example.com' },
					home: { countryCode: 'JP', level1: 'JP-13' },
				},
			})
		}
		return json({})
	})
}

test('@spec components/infrastructure/fan/web/route/event "Code survives sign-up"', async ({
	page,
}) => {
	await mockBackend(page)
	await mockIdentityProvider(page)

	await page.goto(`/events/${EVENT_ID}?ref=member-a`)
	await expect(page.getByText('XX Tour 2026').first()).toBeVisible({
		timeout: 20_000,
	})
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('referral')))
		.toContain('"code":"member-a"')

	await page.getByTestId('event-signup').click()

	// Back on the Event page, signed in, without the query.
	await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}$`), {
		timeout: 20_000,
	})
	await expect(page.getByTestId('event-signup')).toHaveCount(0)
	const kept = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('referral') ?? 'null'),
	)
	expect(kept).toMatchObject({ code: 'member-a', seriesId: SERIES_ID })
})
