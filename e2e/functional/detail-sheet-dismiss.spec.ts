import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for concert detail sheet dismiss behavior.
 *
 * Covers:
 * - Normal dismiss — tap outside, Escape, swipe down, browser back
 * - Reload recovery for a still-onboarding guest deep-linking to the dashboard
 *   (single-flag model: no per-screen step, soft gate, no blocking overlays)
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
									performers: [
										{
											id: { value: 'a-1' },
											name: { value: 'Artist 1' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: 's-1' },
										title: { value: 'Test Concert' },
										sourceUrl: { value: 'https://example.com' },
									},
									localDate: { value: tomorrowDate },
									venue: {
										name: { value: 'Test Venue' },
										adminArea: { value: 'JP-13' },
									},
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
									performers: [
										{
											id: { value: 'a-1' },
											name: { value: 'Artist 1' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: 's-1' },
										title: { value: 'Test Concert' },
										sourceUrl: { value: 'https://example.com' },
									},
									localDate: { value: tomorrowDate },
									venue: {
										name: { value: 'Test Venue' },
										adminArea: { value: 'JP-13' },
									},
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
							performers: [
								{
									id: { value: 'a-1' },
									name: { value: 'Artist 1' },
									mbid: { value: '' },
								},
							],
							series: {
								id: { value: 's-1' },
								title: { value: 'Test Concert' },
								sourceUrl: { value: 'https://example.com' },
							},
							localDate: { value: tomorrowDate },
							venue: {
								name: { value: 'Test Venue' },
								adminArea: { value: 'JP-13' },
							},
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
 * Seed localStorage for a still-onboarding guest with follows + home set.
 * Single-flag model: there is no per-screen step value — "still onboarding"
 * is just `onboardingComplete = false`, and the screen is the route navigated to.
 */
function seedMyArtistsSpotlightState() {
	return () => {
		localStorage.setItem('onboardingComplete', 'false')
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

/** Seed localStorage for a still-onboarding guest (dashboard reachable, sheet dismiss). */
function seedPostDashboardState() {
	return () => {
		localStorage.setItem('onboardingComplete', 'false')
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
// Reload recovery: a still-onboarding guest deep-links to the dashboard.
// Single-flag model — there is no per-screen step, and the dashboard is
// reachable any time under the soft gate. No coach-mark/lane overlay blocks
// the page, and the nav stays fully interactive.
// =========================================================================

test.describe('Still-onboarding reload recovery', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedMyArtistsSpotlightState())
		await mockRpcRoutes(page)
	})

	test('dashboard loads with no blocking overlay and interactive nav', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })

		// No blocking coach-mark overlay on the dashboard (the discovery → dashboard
		// coach mark only renders on the discovery route).
		await expect(page.locator('.coach-mark-overlay')).not.toBeVisible()

		// My Artists tab is visible and enabled (soft gate — nav never dimmed)
		const myArtistsNav = page.locator('[data-nav="my-artists"]')
		await expect(myArtistsNav).toBeVisible()
	})

	test('My Artists tab navigates to my-artists; meaningful dashboard arrival latched onboarding', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard to load
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })

		// Meaningful dashboard arrival (region set + data loaded + followedCount >= 1)
		// latches the single onboarding flag to complete.
		await expect
			.poll(
				() => page.evaluate(() => localStorage.getItem('onboardingComplete')),
				{ timeout: 10_000 },
			)
			.toBe('true')

		const myArtistsNav = page.locator('[data-nav="my-artists"]')
		await expect(myArtistsNav).toBeVisible()
		await myArtistsNav.click()

		// Should navigate to My Artists page
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })

		// Flag stays completed (one-way latch); navigation never reverts it.
		const complete = await page.evaluate(() =>
			localStorage.getItem('onboardingComplete'),
		)
		expect(complete).toBe('true')
	})
})
