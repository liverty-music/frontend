import { expect, test } from '@playwright/test'
import { EVENTS, firstMeta, getConcert, listBySeries } from './support'

/**
 * Story `open-a-shared-event-link`, as a guest who has never used the app,
 * against production. Needs a test Organizer's Events (see ./support.ts).
 */
test.describe('open a shared event link (guest)', () => {
	test('shows the event and its preview to a guest from a social post', async ({
		page,
		request,
	}) => {
		// @spec stories/open-a-shared-event-link "Guest from a social post"
		test.skip(!EVENTS.public, 'E2E_EVENT_PUBLIC_ID is required')
		const concert = await getConcert(request, EVENTS.public)
		const title = concert.series.title.value
		const names = (concert.performers ?? []).map((p) => p.name.value)
		const venue =
			concert.listedVenueName?.value || concert.venue?.name?.value || ''

		await page.goto(`/events/${EVENTS.public}`)

		await expect(page.getByTestId('event-title')).toHaveText(title)
		for (const name of names) {
			await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
		}
		await expect(page.getByTestId('event-date')).not.toBeEmpty()
		await expect(page.getByTestId('event-venue')).toHaveText(venue)
		// No sign-in is requested to see the event.
		await expect(page).toHaveURL(new RegExp(`/events/${EVENTS.public}$`))

		// The served HTML carries the event's preview before any script runs.
		const html = await (
			await request.get(`/events/${EVENTS.public}?ref=e2e`)
		).text()
		expect(firstMeta(html, 'og:title')).toContain(title)
		expect(firstMeta(html, 'og:description')).toContain(venue)
		expect(firstMeta(html, 'og:url')).toBe(
			new URL(`/events/${EVENTS.public}`, page.url()).toString(),
		)
	})

	test('shows the not-found view for an unlisted series', async ({
		page,
		request,
	}) => {
		// @spec stories/open-a-shared-event-link "Unlisted series"
		test.skip(!EVENTS.unlisted, 'E2E_EVENT_UNLISTED_ID is required')

		await page.goto(`/events/${EVENTS.unlisted}`)

		await expect(page.getByTestId('event-not-found')).toBeVisible()
		const html = await (await request.get(`/events/${EVENTS.unlisted}`)).text()
		expect(firstMeta(html, 'og:title')).toBe('Liverty Music')
	})

	test("opens the series' earliest event from the notification deep link", async ({
		page,
		request,
	}) => {
		// @spec stories/open-a-shared-event-link "Follower taps the notification"
		// NotifyNewConcerts links a first-party concert to /events/<earliest id>
		// (backend unit test "First-party concert links to its event page");
		// the service worker opens that URL unchanged. Assert the URL it builds
		// opens the earliest Event's page.
		test.skip(!EVENTS.public, 'E2E_EVENT_PUBLIC_ID is required')
		const concert = await getConcert(request, EVENTS.public)
		const [earliest] = await listBySeries(request, concert.series.id.value)
		const deepLink = `/events/${earliest.id.value}`

		await page.goto(deepLink)

		await expect(page).toHaveURL(new RegExp(`${deepLink}$`))
		await expect(page.getByTestId('event-title')).toHaveText(
			concert.series.title.value,
		)
	})

	test('explains a cancelled event and sells nothing', async ({ page }) => {
		// @spec stories/open-a-shared-event-link "Link opened after cancellation"
		test.skip(!EVENTS.cancelled, 'E2E_EVENT_CANCELLED_ID is required')

		await page.goto(`/events/${EVENTS.cancelled}`)

		await expect(page.getByTestId('event-cancelled')).toBeVisible()
		await expect(page.getByTestId('event-signup')).toHaveCount(0)
	})
})
