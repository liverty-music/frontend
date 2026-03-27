import { expect, test } from './fixtures'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concertListResponse() {
	const groupMap = new Map<string, { date: object; away: object[] }>()
	for (let i = 0; i < 6; i++) {
		const date = new Date()
		date.setDate(date.getDate() + 1 + Math.floor(i / 2))
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
			artistId: { value: `artist-${(i % 2) + 1}` },
			localDate: {
				value: {
					year: date.getFullYear(),
					month: date.getMonth() + 1,
					day: date.getDate(),
				},
			},
			startTime: { value: startTimeRfc },
			venue: {
				name: { value: 'Zepp DiverCity' },
				adminArea: { value: 'JP-13' },
			},
			title: { value: 'Zepp Live' },
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

function journeyListResponse() {
	return {
		journeys: [
			{ eventId: { value: 'c0' }, status: 1 },
			{ eventId: { value: 'c1' }, status: 5 },
		],
	}
}

async function setupMocks(
	page: import('@playwright/test').Page,
	opts: { withJourneys: boolean } = { withJourneys: true },
) {
	await page.route('**/liverty_music.rpc.concert.**', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(concertListResponse()),
		})
	})

	if (opts.withJourneys) {
		await page.route('**/liverty_music.rpc.ticket_journey.**', (route) => {
			const url = route.request().url()
			if (url.includes('ListByUser')) {
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(journeyListResponse()),
				})
			} else {
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({}),
				})
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Visual regression tests
// ---------------------------------------------------------------------------

// Badge tests require authenticated state — fixme until auth fixture is available
test.describe.fixme('Ticket journey badge visual regression', () => {
	test('dashboard with journey badges', async ({ layoutPage: page }) => {
		await page.addInitScript(() => {
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
				]),
			)
		})
		await setupMocks(page)
		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', { timeout: 10_000 })

		await expect(page).toHaveScreenshot('ticket-journey-badges.png')
	})
})

test.describe('Detail sheet journey controls visual regression', () => {
	test.describe.configure({ mode: 'serial' })

	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem('onboarding.celebrationShown', '1')
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
				]),
			)
		})

		await page.unrouteAll({ behavior: 'ignoreErrors' })
		await setupMocks(page)

		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', { timeout: 10_000 })

		await page.evaluate(() => {
			document.querySelectorAll('[popover]').forEach((el) => {
				try {
					;(el as HTMLElement).hidePopover()
				} catch {}
			})
		})

		await page.locator('[data-live-card]').first().click()
		await page.waitForSelector('[data-testid="sheet-journey"]', {
			timeout: 5_000,
		})
	})

	test('detail sheet with journey controls', async ({
		layoutPage: page,
	}) => {
		await expect(page).toHaveScreenshot('ticket-journey-detail-sheet.png')
	})

	test('detail sheet after setting status', async ({
		layoutPage: page,
	}) => {
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLElement>(
				'[data-testid="journey-btn"][data-journey-status="tracking"]',
			)
			btn?.click()
		})
		const trackingBtn = page.locator(
			'[data-testid="journey-btn"][data-journey-status="tracking"]',
		)
		await expect
			.poll(async () => trackingBtn.getAttribute('data-active'), {
				timeout: 3_000,
			})
			.not.toBeNull()

		await expect(page).toHaveScreenshot(
			'ticket-journey-status-active.png',
		)
	})
})
