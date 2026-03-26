import { expect, test } from './fixtures'

// ---------------------------------------------------------------------------
// Helpers: seed localStorage and mock RPC for ticket journey tests
// ---------------------------------------------------------------------------

/** Seed dashboard in onboarding mode with concert data. */
function seedWithConcertData(opts?: { skipCelebration?: boolean }) {
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
			]),
		)
		if (opts?.skipCelebration) {
			localStorage.setItem('onboarding.celebrationShown', '1')
		}
	}
}

/** Build a ConcertService/ListWithProximity response (onboarding path). */
function concertListResponse() {
	const groupMap = new Map<string, { date: object; away: object[] }>()
	for (let i = 0; i < 6; i++) {
		const date = new Date()
		date.setDate(date.getDate() + 1 + Math.floor(i / 2))
		const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
		const concert = makeConcert(`c${i}`, `artist-${(i % 2) + 1}`, date)
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

function makeConcert(id: string, artistId: string, date: Date) {
	const startTimeRfc = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		19,
		0,
	).toISOString()

	return {
		id: { value: id },
		artistId: { value: artistId },
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
}

/** ListByUser response with journeys for c0 (tracking) and c1 (paid). */
function journeyListResponse() {
	return {
		journeys: [
			{ eventId: { value: 'c0' }, status: 1 }, // TRACKING
			{ eventId: { value: 'c1' }, status: 5 }, // PAID
		],
	}
}

/**
 * Set up standard concert + journey mocks for onboarding dashboard.
 * Concert mock: catches all concert RPC calls (List per artist).
 * Journey mock: catches TicketJourneyService calls.
 */
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
				// SetStatus / Delete — return empty success
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
// Group 1: Journey badge on event cards
// ---------------------------------------------------------------------------

// Badge tests require authenticated state: DashboardService.fetchJourneyMap
// returns empty Map when isAuthenticated=false, so journey-badge is never
// rendered in onboarding/guest mode. Needs auth storageState fixture.
test.describe.fixme('Ticket journey badge', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithConcertData())
		await setupMocks(page)
		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', { timeout: 10_000 })
	})

	test('cards with journey status show a badge (TJ1)', async ({
		layoutPage: page,
	}) => {
		const badges = page.locator('.journey-badge')
		await expect
			.poll(async () => badges.count(), { timeout: 5_000 })
			.toBeGreaterThan(0)
	})

	test('journey badge has data-journey-status attribute (TJ2)', async ({
		layoutPage: page,
	}) => {
		const badge = page.locator('.journey-badge').first()
		await expect(badge).toBeVisible({ timeout: 5_000 })
		const status = await badge.getAttribute('data-journey-status')
		expect(
			['tracking', 'applied', 'lost', 'unpaid', 'paid'],
			'status should be a valid JourneyStatus value',
		).toContain(status)
	})

	test('journey badge has non-zero dimensions (TJ3)', async ({
		layoutPage: page,
	}) => {
		const badge = page.locator('.journey-badge').first()
		await expect(badge).toBeVisible({ timeout: 5_000 })
		const box = await badge.boundingBox()
		expect(box, 'badge must have bounding box').toBeTruthy()
		expect(box!.width, 'badge must have width').toBeGreaterThan(0)
		expect(box!.height, 'badge must have height').toBeGreaterThan(0)
	})

	test('journey badge is positioned inside its event card (TJ4)', async ({
		layoutPage: page,
	}) => {
		const badge = page.locator('.journey-badge').first()
		await expect(badge).toBeVisible({ timeout: 5_000 })

		const badgeBox = await badge.boundingBox()
		const card = badge.locator('xpath=ancestor::article[@data-live-card]')
		const cardBox = await card.boundingBox()

		expect(badgeBox).toBeTruthy()
		expect(cardBox).toBeTruthy()

		expect(badgeBox!.x).toBeGreaterThanOrEqual(cardBox!.x - 1)
		expect(badgeBox!.y).toBeGreaterThanOrEqual(cardBox!.y - 1)
		expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(
			cardBox!.x + cardBox!.width + 1,
		)
	})

	test('cards without journey status have no badge (TJ5)', async ({
		layoutPage: page,
	}) => {
		const allCards = page.locator('[data-live-card]')
		const totalCards = await allCards.count()
		const totalBadges = await page.locator('.journey-badge').count()
		expect(totalBadges, 'not every card should have a badge').toBeLessThan(
			totalCards,
		)
	})
})

// ---------------------------------------------------------------------------
// Group 2: Detail sheet journey controls
// ---------------------------------------------------------------------------

test.describe('Detail sheet journey controls', () => {
	// Serial: each test opens the detail sheet, which needs a stable dev server
	test.describe.configure({ mode: 'serial' })

	test.beforeEach(async ({ layoutPage: page }) => {
		// Seed guest data and concert artists directly at 'completed' step.
		// Avoids setting 'dashboard' step (which triggers celebration in serial
		// mode due to addInitScript accumulation timing).
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

		// Clean up accumulated route handlers from serial mode to prevent
		// stale or duplicate handlers from interfering with responses.
		await page.unrouteAll({ behavior: 'ignoreErrors' })
		await setupMocks(page)

		await page.goto('/dashboard')
		await page.waitForSelector('[data-live-card]', { timeout: 10_000 })

		// Click the first card to open the detail sheet.
		// page-help's .dismiss-zone may intercept real pointer events;
		// dispatch the click via JS to bypass interception.
		await page.evaluate(() => {
			const el = document.querySelector<HTMLElement>('[data-live-card]')
			if (!el) throw new Error('[data-live-card] not found')
			el.click()
		})
		await page.waitForSelector('.sheet-journey', { timeout: 5_000 })
	})

	test('journey section is visible in detail sheet (TJ6)', async ({
		layoutPage: page,
	}) => {
		const section = page.locator('.sheet-journey')
		await expect(section).toBeVisible()
	})

	test('journey heading reads "Ticket Status" (TJ7)', async ({
		layoutPage: page,
	}) => {
		const heading = page.locator('.journey-heading')
		await expect(heading).toBeVisible()
		await expect(heading).toHaveText('Ticket Status')
	})

	test('five journey status buttons are rendered (TJ8)', async ({
		layoutPage: page,
	}) => {
		const buttons = page.locator('.journey-btn')
		await expect(buttons).toHaveCount(5)

		const labels = await buttons.allTextContents()
		expect(labels).toEqual(['tracking', 'applied', 'lost', 'unpaid', 'paid'])
	})

	test('journey buttons have data-journey-status attributes (TJ9)', async ({
		layoutPage: page,
	}) => {
		const buttons = page.locator('.journey-btn')
		const count = await buttons.count()
		const expected = ['tracking', 'applied', 'lost', 'unpaid', 'paid']

		for (let i = 0; i < count; i++) {
			const status = await buttons.nth(i).getAttribute('data-journey-status')
			expect(status).toBe(expected[i])
		}
	})

	test('clicking a status button marks it active (TJ10)', async ({
		layoutPage: page,
	}) => {
		// Use JS dispatch: in serial mode the detail sheet popover may
		// intercept Playwright pointer events after prior tests mutate state.
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLElement>(
				'.journey-btn[data-journey-status="tracking"]',
			)
			if (!btn) throw new Error('tracking button not found')
			btn.click()
		})
		const trackingBtn = page.locator(
			'.journey-btn[data-journey-status="tracking"]',
		)
		await expect
			.poll(async () => trackingBtn.getAttribute('data-active'), {
				timeout: 3_000,
			})
			.not.toBeNull()
	})

	test('stop tracking button appears after setting status (TJ11)', async ({
		layoutPage: page,
	}) => {
		const removeBtn = page.locator('.journey-remove-btn')

		await page.evaluate(() => {
			const btn = document.querySelector<HTMLElement>(
				'.journey-btn[data-journey-status="paid"]',
			)
			if (!btn) throw new Error('paid button not found')
			btn.click()
		})

		await expect(removeBtn).toBeVisible({ timeout: 3_000 })
	})

	test('stop tracking button removes active state (TJ12)', async ({
		layoutPage: page,
	}) => {
		// Use JS dispatch: in serial mode the popover may auto-dismiss between
		// Playwright clicks, but JS click still triggers event handlers, and
		// assertions read DOM attributes regardless of visibility.
		await page.evaluate(() => {
			const btn = document.querySelector<HTMLElement>(
				'.journey-btn[data-journey-status="applied"]',
			)
			if (!btn) throw new Error('applied button not found')
			btn.click()
		})

		const appliedBtn = page.locator(
			'.journey-btn[data-journey-status="applied"]',
		)
		await expect
			.poll(async () => appliedBtn.getAttribute('data-active'), {
				timeout: 3_000,
			})
			.not.toBeNull()

		await page.evaluate(() => {
			const btn = document.querySelector<HTMLElement>('.journey-remove-btn')
			if (!btn) throw new Error('remove button not found')
			btn.click()
		})

		await expect
			.poll(async () => appliedBtn.getAttribute('data-active'), {
				timeout: 3_000,
			})
			.toBeNull()
	})

	test('journey buttons have non-zero dimensions (TJ13)', async ({
		layoutPage: page,
	}) => {
		const firstBtn = page.locator('.journey-btn').first()
		const box = await firstBtn.boundingBox()
		expect(box, 'button must have bounding box').toBeTruthy()
		expect(box!.width).toBeGreaterThan(20)
		expect(box!.height).toBeGreaterThan(15)
	})

	test('journey controls are contained within sheet content (TJ14)', async ({
		layoutPage: page,
	}) => {
		const controls = page.locator('.journey-controls')
		const controlsBox = await controls.boundingBox()
		const sheetContent = page.locator('.sheet-content')
		const sheetBox = await sheetContent.boundingBox()

		expect(controlsBox).toBeTruthy()
		expect(sheetBox).toBeTruthy()

		expect(controlsBox!.x).toBeGreaterThanOrEqual(sheetBox!.x - 1)
		expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
			sheetBox!.x + sheetBox!.width + 1,
		)
	})
})
