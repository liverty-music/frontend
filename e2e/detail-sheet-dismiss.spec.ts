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
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		if (url.includes('ListByFollower')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: { value: { year: 2026, month: 3, day: 15 } },
							away: [
								{
									id: { value: 'c-1' },
									title: { value: 'Test Concert' },
									localDate: {
										value: { year: 2026, month: 3, day: 15 },
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
							title: { value: 'Test Concert' },
							localDate: {
								value: { year: 2026, month: 3, day: 15 },
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

/** Seed localStorage for Step 4 state (detail sheet open, spotlight on My Artists). */
function seedStep4State() {
	return () => {
		localStorage.setItem('onboardingStep', '4')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ id: 'a-1', name: 'Artist 1' },
				{ id: 'a-2', name: 'Artist 2' },
				{ id: 'a-3', name: 'Artist 3' },
			]),
		)
	}
}

/** Seed localStorage for completed onboarding (normal user). */
function seedCompletedState() {
	return () => {
		localStorage.setItem('onboardingStep', '7')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{ id: 'a-1', name: 'Artist 1' },
				{ id: 'a-2', name: 'Artist 2' },
				{ id: 'a-3', name: 'Artist 3' },
			]),
		)
	}
}

/** Open a detail sheet by clicking a concert card. */
async function openDetailSheet(page: Page): Promise<void> {
	const card = page.locator('[data-live-card]').first()
	await expect(card).toBeVisible({ timeout: 15_000 })
	await card.click()

	// Wait for sheet to be visible via popover
	const sheet = page.locator('dialog.event-detail-sheet')
	await expect(sheet).toBeVisible({ timeout: 5000 })
}

// =========================================================================
// Task 5.1: Step 3→4 — coach mark renders above detail sheet
// =========================================================================

test.describe('Step 3→4: Coach mark above detail sheet', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await mockRpcRoutes(page)
	})

	test('coach mark spotlight visible above detail sheet at Step 4', async ({
		page,
	}) => {
		test.setTimeout(60_000)

		// Seed Step 3 at card phase (skip celebration + region + lane intro)
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ id: 'a-1', name: 'Artist 1' },
					{ id: 'a-2', name: 'Artist 2' },
					{ id: 'a-3', name: 'Artist 3' },
				]),
			)
		})
		await page.goto('http://localhost:9000/dashboard')

		// Wait for lane intro to reach card phase
		const cardInterceptor = page.locator('.target-interceptor')
		await expect(cardInterceptor).toBeVisible({ timeout: 20_000 })

		// Wait for card phase specifically
		await page.waitForTimeout(8000)

		// Tap card — opens detail sheet and advances to Step 4
		await cardInterceptor.click()

		// Verify step advanced
		const step = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(step).toBe('4')

		// Detail sheet should be visible
		const sheet = page.locator('dialog.event-detail-sheet')
		await expect(sheet).toBeVisible({ timeout: 5000 })

		// Coach mark spotlight should be visible ABOVE the detail sheet
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toBeVisible({ timeout: 5000 })

		// Coach mark tooltip should show My Artists guidance
		const tooltip = page.locator('.coach-mark-tooltip')
		await expect(tooltip).toBeVisible()

		// My Artists tab interceptor should be clickable (coach mark on top)
		const myArtistsInterceptor = page.locator('.target-interceptor')
		await expect(myArtistsInterceptor).toBeVisible()

		// Tapping My Artists advances to Step 5
		await myArtistsInterceptor.click()
		const stepAfter = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfter).toBe('5')
	})
})

// =========================================================================
// Task 5.2: Normal detail sheet dismiss (non-onboarding)
// =========================================================================

test.describe('Normal detail sheet dismiss', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedCompletedState())
		await mockRpcRoutes(page)
		await page.goto('http://localhost:9000/dashboard')
	})

	test('tap outside (light dismiss) closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		// Tap outside the sheet (top of page, above the bottom sheet)
		await page.mouse.click(200, 50)

		// Sheet should close
		const sheet = page.locator('dialog.event-detail-sheet')
		await expect(sheet).not.toBeVisible({ timeout: 3000 })

		// URL should revert to dashboard
		await expect(page).toHaveURL(/dashboard/)
	})

	test('Escape key closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		// Press Escape
		await page.keyboard.press('Escape')

		// Sheet should close
		const sheet = page.locator('dialog.event-detail-sheet')
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
		const sheet = page.locator('dialog.event-detail-sheet')
		await expect(sheet).not.toBeVisible({ timeout: 3000 })

		// URL should be dashboard (browser navigated back)
		await expect(page).toHaveURL(/dashboard/)
	})

	test('swipe down closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		const sheet = page.locator('dialog.event-detail-sheet')
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
// Task 5.3: Page reload during Step 4
// =========================================================================

test.describe('Step 4 reload recovery', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedStep4State())
		await mockRpcRoutes(page)
	})

	test('coach mark re-appears on reload at Step 4', async ({ page }) => {
		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard to load and spotlight to activate
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toBeVisible({ timeout: 10_000 })

		// Coach mark tooltip should be visible
		const tooltip = page.locator('.coach-mark-tooltip')
		await expect(tooltip).toBeVisible()

		// My Artists tab should be targeted
		const myArtistsNav = page.locator('[data-nav-my-artists]')
		await expect(myArtistsNav).toBeVisible()
	})

	test('My Artists tab is tappable after Step 4 reload', async ({ page }) => {
		await page.goto('http://localhost:9000/dashboard')

		// Wait for spotlight
		const interceptor = page.locator('.target-interceptor')
		await expect(interceptor).toBeVisible({ timeout: 10_000 })

		// Tap through the interceptor
		await interceptor.click()

		// Should advance to Step 5 and navigate to My Artists
		const step = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(step).toBe('5')
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })
	})
})
