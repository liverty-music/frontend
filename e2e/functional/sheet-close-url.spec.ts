import { expect, type Page, test } from '../support/test'

/**
 * Closing a concert's detail sheet returns to the dashboard URL the fan was on,
 * filters included, so a reload shows the same filtered timetable. It used to
 * rewrite the URL to a bare `/dashboard`, dropping the filter still on screen.
 */

const APP = 'http://localhost:9000'

function localDate(offset: number) {
	const d = new Date()
	d.setDate(d.getDate() + offset)
	return {
		value: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
	}
}

const artists = Array.from({ length: 3 }, (_, i) => ({
	id: `artist-${i}`,
	name: `ARTIST ${i}`,
	mbid: '',
}))

const groups = Array.from({ length: 12 }, (_, i) => ({
	date: localDate(i + 1),
	home: [
		{
			id: { value: `c-${i}` },
			performers: [
				{
					id: { value: artists[i % 3].id },
					name: { value: artists[i % 3].name },
					mbid: { value: '' },
				},
			],
			series: { id: { value: `s-${i}` }, title: { value: 'Live' } },
			localDate: localDate(i + 1),
			venue: { name: { value: 'Zepp' }, adminArea: { value: 'JP-13' } },
			sourceUrl: { value: 'https://example.com' },
		},
	],
	nearby: [],
	away: [],
}))

async function prepare(page: Page): Promise<void> {
	await page.addInitScript((followed) => {
		localStorage.setItem('onboardingStep', 'completed')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify(followed.map((artist) => ({ artist, hype: 'home' }))),
		)
	}, artists)
	await page.route('**/liverty_music.rpc.**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: route.request().url().includes('ListByArtists')
				? JSON.stringify({ groups })
				: '{}',
		}),
	)
	await page.route('**/ws.audioscrobbler.com/**', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
	)
}

function sheetOpen(page: Page): Promise<boolean> {
	return page.evaluate(
		() =>
			!!document.querySelector(
				'event-detail-sheet dialog[open], event-detail-sheet :popover-open',
			),
	)
}

/** Artists whose concerts are on the timetable. */
function shownArtists(page: Page): Promise<string[]> {
	return page.evaluate(() => [
		...new Set(
			[...document.querySelectorAll('[data-live-card] .artist-name')].map(
				(n) => n.textContent?.trim() ?? '',
			),
		),
	])
}

test('@spec components/infrastructure/fan/web/route/dashboard "Closing a deep-linked sheet returns to the filtered dashboard URL"', async ({
	page,
}) => {
	await prepare(page)
	await page.goto(`${APP}/concerts/c-4`)
	await expect.poll(() => sheetOpen(page), { timeout: 15_000 }).toBe(true)
	await expect(page).toHaveURL(/\/concerts\/c-4$/)

	await page.keyboard.press('Escape')
	await expect.poll(() => sheetOpen(page)).toBe(false)
	// The filter the deep-link derived is in the URL…
	await expect(page).toHaveURL(`${APP}/dashboard?artists=artist-1`)
	expect(await shownArtists(page)).toEqual(['ARTIST 1'])

	// …so a reload shows the same filtered timetable.
	await page.reload()
	await page.locator('[data-live-card]').first().waitFor({ timeout: 15_000 })
	expect(await shownArtists(page)).toEqual(['ARTIST 1'])
})

test('@spec components/infrastructure/fan/web/route/dashboard "Closing keeps the active filters in the URL"', async ({
	page,
}) => {
	await prepare(page)
	await page.goto(`${APP}/dashboard?artists=artist-2`)
	await page.locator('[data-live-card]').first().waitFor({ timeout: 15_000 })
	expect(await shownArtists(page)).toEqual(['ARTIST 2'])

	await page.locator('[data-live-card]').first().click()
	await expect.poll(() => sheetOpen(page)).toBe(true)
	await expect(page).toHaveURL(/\/concerts\//)

	await page.keyboard.press('Escape')
	await expect.poll(() => sheetOpen(page)).toBe(false)
	await expect(page).toHaveURL(`${APP}/dashboard?artists=artist-2`)
})
