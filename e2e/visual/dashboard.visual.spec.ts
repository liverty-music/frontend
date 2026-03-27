import { expect, test } from './fixtures'

// ---------------------------------------------------------------------------
// Helpers: seed localStorage and mock RPC to produce deterministic states
// ---------------------------------------------------------------------------

function seedDashboardState() {
	return () => {
		localStorage.setItem('onboardingStep', 'dashboard')
		localStorage.setItem('guest.home', 'JP-13')
	}
}

function seedWithConcertData() {
	return () => {
		localStorage.setItem('onboardingStep', 'dashboard')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{
					artist: { id: 'artist-1', name: 'YOASOBI', mbid: 'mbid-1' },
					home: 'JP-13',
				},
				{
					artist: { id: 'artist-2', name: 'Vaundy', mbid: 'mbid-2' },
					home: 'JP-13',
				},
				{
					artist: { id: 'artist-3', name: 'Ado', mbid: 'mbid-3' },
					home: 'JP-13',
				},
			]),
		)
	}
}

function concertListResponse() {
	const venues = [
		'Zepp DiverCity',
		'Budokan',
		'Zepp Osaka',
		'Makuhari Messe',
		'Yokohama Arena',
	]
	const areas = ['JP-13', 'JP-27', 'JP-12', 'JP-14', 'JP-04']
	const groupMap = new Map<string, { date: object; away: object[] }>()

	for (let i = 0; i < 20; i++) {
		const date = new Date()
		date.setDate(date.getDate() + 1 + Math.floor(i / 3))
		const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
		const startTimeRfc = new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate(),
			19,
			0,
		).toISOString()

		const concert = {
			id: { value: `c${i}` },
			artistId: { value: `artist-${(i % 3) + 1}` },
			localDate: {
				value: {
					year: date.getFullYear(),
					month: date.getMonth() + 1,
					day: date.getDate(),
				},
			},
			startTime: { value: startTimeRfc },
			venue: {
				name: { value: venues[i % venues.length] },
				adminArea: { value: areas[i % areas.length] },
			},
			title: { value: `${venues[i % venues.length]} Live` },
			sourceUrl: { value: 'https://example.com' },
		}

		if (!groupMap.has(dateKey)) {
			groupMap.set(dateKey, {
				date: {
					value: {
						year: date.getFullYear(),
						month: date.getMonth() + 1,
						day: date.getDate(),
					},
				},
				away: [],
			})
		}
		groupMap.get(dateKey)!.away.push(concert)
	}

	return { groups: Array.from(groupMap.values()) }
}

// ---------------------------------------------------------------------------
// Visual regression tests
// ---------------------------------------------------------------------------

test.describe('Dashboard visual regression', () => {
	test('empty state layout', async ({ layoutPage: page }) => {
		await page.addInitScript(seedDashboardState())
		await page.goto('/dashboard')
		await page.waitForSelector('concert-highway, state-placeholder', {
			timeout: 5000,
		})

		await expect(page).toHaveScreenshot('dashboard-empty-state.png')
	})

	test('data-loaded state with concert cards', async ({
		layoutPage: page,
	}) => {
		await page.addInitScript(seedWithConcertData())
		await page.route('**/liverty_music.rpc.concert.**', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(concertListResponse()),
			})
		})
		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', { timeout: 10000 })

		await expect(page).toHaveScreenshot('dashboard-data-loaded.png')
	})

	test('layout after scrolling concert list', async ({
		layoutPage: page,
	}) => {
		await page.addInitScript(seedWithConcertData())
		await page.route('**/liverty_music.rpc.concert.**', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(concertListResponse()),
			})
		})
		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', { timeout: 10000 })

		const scrollContainer = page.locator(
			'concert-highway [data-testid="concert-scroll"]',
		)
		await scrollContainer.evaluate((el) => {
			el.scrollTop = 400
		})
		// Wait for scroll to settle
		await expect(page.locator('.stage-header').first()).toBeVisible()

		await expect(page).toHaveScreenshot('dashboard-after-scroll.png')
	})

	test('blur state when no home region set', async ({
		layoutPage: page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
		})
		await page.goto('/dashboard')
		await page.waitForSelector('[data-blurred], user-home-selector', {
			timeout: 5000,
		})

		await expect(page).toHaveScreenshot('dashboard-blur-state.png')
	})
})
