import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for concert detail sheet dismiss behavior.
 *
 * Covers:
 * - Task 5.1: Step 3→4 flow — coach mark renders above detail sheet
 * - Task 5.2: Normal dismiss — tap outside, Escape, swipe down, browser back
 * - Task 5.3: Page reload during Step 4 — coach mark re-appears above sheet
 */

/** Mock Connect-RPC routes with concert data for dashboard rendering. */
async function mockRpcRoutes(page: Page): Promise<void> {
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)
	const tomorrowDate = {
		year: tomorrow.getFullYear(),
		month: tomorrow.getMonth() + 1,
		day: tomorrow.getDate(),
	}

	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		// ListWithProximity (check before ListByFollower/List)
		if (url.includes('ListWithProximity')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: { value: tomorrowDate },
							home: [
								{
									id: { value: 'c-1' },
									artistId: { value: 'a-1' },
									title: { value: 'Test Concert' },
									localDate: { value: tomorrowDate },
									venue: {
										name: { value: 'Test Venue' },
										adminArea: { value: 'JP-13' },
									},
									sourceUrl: { value: 'https://example.com' },
								},
							],
							nearby: [],
							away: [],
						},
					],
				}),
			})
		}

		if (url.includes('ListByFollower')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: { value: tomorrowDate },
							home: [],
							nearby: [],
							away: [
								{
									id: { value: 'c-1' },
									artistId: { value: 'a-1' },
									title: { value: 'Test Concert' },
									localDate: { value: tomorrowDate },
									venue: {
										name: { value: 'Test Venue' },
										adminArea: { value: 'JP-13' },
									},
									sourceUrl: { value: 'https://example.com' },
								},
							],
						},
					],
				}),
			})
		}

		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					concerts: [
						{
							id: { value: 'c-1' },
							artistId: { value: 'a-1' },
							title: { value: 'Test Concert' },
							localDate: { value: tomorrowDate },
							venue: {
								name: { value: 'Test Venue' },
								adminArea: { value: 'JP-13' },
							},
							sourceUrl: { value: 'https://example.com' },
						},
					],
				}),
			})
		}

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{ id: { value: 'a-1' }, name: { value: 'Artist 1' }, hype: 0 },
						{ id: { value: 'a-2' }, name: { value: 'Artist 2' }, hype: 0 },
						{ id: { value: 'a-3' }, name: { value: 'Artist 3' }, hype: 0 },
					],
				}),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/**
 * Seed localStorage for the MY_ARTISTS spotlight state.
 * In the new flow, after celebration dismiss the step is 'my-artists'
 * and the coach mark targets the My Artists nav tab.
 */
function seedMyArtistsSpotlightState() {
	return () => {
		localStorage.setItem('onboardingStep', 'my-artists')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
				{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
				{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
			]),
		)
	}
}

/** Seed localStorage for a state past dashboard (my-artists allows dashboard access and sheet dismiss). */
function seedPostDashboardState() {
	return () => {
		localStorage.setItem('onboardingStep', 'my-artists')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
				{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
				{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
			]),
		)
	}
}

/** Open a detail sheet by clicking a concert card. */
async function openDetailSheet(page: Page): Promise<void> {
	const card = page.locator('[data-live-card]').first()
	await expect(card).toBeVisible({ timeout: 15_000 })
	await card.click()

	// Wait for sheet — bottom-sheet is a popover, wait for popover-open state
	const sheet = page.locator('event-detail-sheet bottom-sheet')
	await expect(sheet).toBeVisible({ timeout: 5000 })
}

// =========================================================================
// Task 5.2: Normal detail sheet dismiss (non-onboarding)
// =========================================================================

test.describe('Normal detail sheet dismiss', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedPostDashboardState())
		await mockRpcRoutes(page)
		await page.goto('http://localhost:9000/dashboard')
	})

	// TODO: Bottom-sheet scroll-snap dismiss doesn't trigger reliably in headless Chromium.
	// The dialog popover="auto" light-dismiss and scroll-to-dismiss-zone both depend
	// on smooth scrolling and scrollend events that may not fire in CI.
	test.fixme('tap outside (light dismiss) closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		// Tap outside the sheet (top of page, above the bottom sheet)
		await page.mouse.click(200, 50)

		// Sheet should close
		const sheet = page.locator('event-detail-sheet bottom-sheet')
		await expect(sheet).not.toBeVisible({ timeout: 3000 })

		// URL should revert to dashboard
		await expect(page).toHaveURL(/dashboard/)
	})

	test.fixme('Escape key closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		// Press Escape
		await page.keyboard.press('Escape')

		// Sheet should close
		const sheet = page.locator('event-detail-sheet bottom-sheet')
		await expect(sheet).not.toBeVisible({ timeout: 3000 })

		// URL should revert to dashboard
		await expect(page).toHaveURL(/dashboard/)
	})

	test('browser back button closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		// URL should have changed to /concerts/...
		await expect(page).toHaveURL(/concerts/)

		// Go back
		await page.goBack()

		// Sheet should close
		const sheet = page.locator('event-detail-sheet bottom-sheet')
		await expect(sheet).not.toBeVisible({ timeout: 3000 })

		// URL should be dashboard (browser navigated back)
		await expect(page).toHaveURL(/dashboard/)
	})

	test.fixme('swipe down closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		const sheet = page.locator('event-detail-sheet bottom-sheet')
		const box = await sheet.boundingBox()
		expect(box).toBeTruthy()

		// Simulate swipe down from top of sheet (150px > 100px threshold)
		const startX = box!.x + box!.width / 2
		const startY = box!.y + 20

		await page.touchscreen.tap(startX, startY)
		// Playwright touchscreen doesn't have swipe, use mouse to simulate
		await page.mouse.move(startX, startY)
		await page.mouse.down()
		await page.mouse.move(startX, startY + 160, { steps: 10 })
		await page.mouse.up()

		// Sheet should close (or at least start closing transition)
		await expect(sheet).not.toBeVisible({ timeout: 5000 })
	})
})

// =========================================================================
// Task 5.3: Page reload during MY_ARTISTS spotlight state
// (The old 'detail' step is removed; reload recovery now tests 'my-artists' state)
// =========================================================================

test.describe('MY_ARTISTS spotlight reload recovery', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedMyArtistsSpotlightState())
		await mockRpcRoutes(page)
	})

	test('dashboard loads normally after reload at my-artists step', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		// Dashboard should load without active coach mark (step is 'my-artists', not 'dashboard')
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })

		// Lane intro overlay should not be visible (step is not 'dashboard')
		await expect(page.locator('.coach-mark-overlay')).not.toBeVisible()

		// My Artists tab should be visible and enabled (nav not dimmed)
		const myArtistsNav = page.locator('[data-nav="my-artists"]')
		await expect(myArtistsNav).toBeVisible()
	})

	test('My Artists tab navigates to my-artists page after reload', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard to load
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })

		const myArtistsNav = page.locator('[data-nav="my-artists"]')
		await expect(myArtistsNav).toBeVisible()
		await myArtistsNav.click()

		// Should navigate to My Artists page
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })

		// Step stays at 'my-artists' (hype change completes it, not navigation)
		const step = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(step).toBe('my-artists')
	})
})
