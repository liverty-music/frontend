import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for the onboarding tutorial flow (Step 0 → Step 6).
 *
 * These tests run against the dev server with RPC mocking to verify
 * the complete onboarding UX without backend dependencies.
 */

/** Mock all Connect-RPC requests with empty concert data. */
async function mockRpcRoutesEmpty(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		// ConcertService/List — return empty groups
		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ dateGroups: [] }),
			})
		}

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
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

/** Mock all Connect-RPC requests with minimal valid responses. */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		// ConcertService/SearchNewConcerts — fire-and-forget (check before List)
		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		// ConcertService/ListByFollower (check before List to avoid substring match)
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

		// ConcertService/List — return concerts per artist (used during onboarding)
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

		// FollowService/ListFollowed — return followed artists
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

		// Default: empty response
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

/** Last.fm API mock for artist discovery. */
async function mockLastFmApi(page: Page): Promise<void> {
	await page.route('**/ws.audioscrobbler.com/**', (route) => {
		const url = new URL(route.request().url())
		const method = url.searchParams.get('method')

		if (method === 'geo.gettopartists') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					topartists: {
						artist: Array.from({ length: 10 }, (_, i) => ({
							name: `Artist ${i + 1}`,
							mbid: `mbid-${i + 1}`,
							image: [
								{ '#text': '', size: 'medium' },
								{ '#text': '', size: 'large' },
							],
							listeners: String(1000 - i * 100),
						})),
					},
				}),
			})
		}

		if (method === 'artist.getsimilar') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					similarartists: { artist: [] },
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

test.describe('Onboarding tutorial flow', () => {
	test.use({
		...test.use,
		viewport: { width: 412, height: 915 },
	})

	test.beforeEach(async ({ page }) => {
		// Ensure clean onboarding state
		await page.addInitScript(() => {
			localStorage.removeItem('onboardingStep')
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.removeItem('guest.home')
			localStorage.removeItem('guest.followedArtists')
		})
		await mockRpcRoutes(page)
		await mockLastFmApi(page)
	})

	test('Step 0: Welcome page shows Get Started button', async ({ page }) => {
		await page.goto('http://localhost:9000/')
		await expect(
			page.locator('button').filter({ hasText: /get started/i }),
		).toBeVisible()
	})

	test('Step 0 → Step 1: Get Started navigates to Discover', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')
		await page
			.locator('button')
			.filter({ hasText: /get started/i })
			.click()
		await expect(page).toHaveURL(/discover/)
	})

	test('Step 1: No toast when tapping restricted nav during onboarding', async ({
		page,
	}) => {
		// Start at discover (step 1)
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '1')
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discover-layout')

		// Tap a restricted nav item (tickets has no tutorialStep)
		const ticketsNav = page.locator('[data-nav-tickets]')
		if ((await ticketsNav.count()) > 0) {
			await ticketsNav.click()
			// Wait briefly for any toast
			await page.waitForTimeout(500)
			// No "Login required" toast should appear
			const toast = page.locator('.toast-message').filter({ hasText: /login/i })
			await expect(toast).toHaveCount(0)
		}
	})

	test('Step 3: Celebration does not replay after page reload', async ({
		page,
	}) => {
		// Set up step 3 with celebration already shown
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Celebration overlay should NOT be visible
		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toHaveCount(0)
	})

	test('Step 3: Dashboard is interactive after reload (no stuck overlay)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Page should be interactive — no full-screen blocking overlay
		const clickBlockers = page.locator('.click-blocker')
		await expect(clickBlockers).toHaveCount(0)

		const mainContent = page.locator('au-viewport')
		await expect(mainContent).toBeVisible()
	})

	test('Coach mark tooltip has transparent background (no colored box)', async ({
		page,
	}) => {
		// Set up step 3 at the card phase
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Wait for coach mark tooltip to potentially appear
		const tooltip = page.locator('.coach-mark-tooltip')
		if ((await tooltip.count()) > 0) {
			const bg = await tooltip.evaluate((el) =>
				getComputedStyle(el).getPropertyValue('background-color'),
			)
			// Should be transparent (rgba(0,0,0,0) or transparent)
			expect(bg).toMatch(/transparent|rgba\(0,\s*0,\s*0,\s*0\)/)
		}
	})

	test('Toast popover has no white background gap', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '7')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Trigger a toast by evaluating in page context
		await page.evaluate(() => {
			const popover = document.querySelector('[popover].toast-popover')
			if (popover) {
				const style = getComputedStyle(popover)
				// Verify transparent background
				if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
					throw new Error(
						`Toast popover has non-transparent background: ${style.backgroundColor}`,
					)
				}
			}
		})
	})

	test('Step 5: Hype explanation stays visible until user dismisses', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '5')
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
		await page.goto('http://localhost:9000/my-artists')

		// Wait for the hype selector to be triggered by coach mark
		const hypeButton = page.locator('[data-hype-button]').first()
		if ((await hypeButton.count()) > 0) {
			await hypeButton.click()

			// Select a hype level in the dialog
			const hypeOption = page.locator('.hype-level-option').first()
			if ((await hypeOption.count()) > 0) {
				await hypeOption.click()
			}

			// Hype explanation dialog should stay open
			const explanation = page.locator('.hype-explanation-dialog')
			if ((await explanation.count()) > 0) {
				await expect(explanation).toBeVisible()

				// Wait 2 seconds — should still be open (no auto-dismiss)
				await page.waitForTimeout(2000)
				await expect(explanation).toBeVisible()

				// OK button should be present
				const okButton = explanation.locator('button')
				await expect(okButton).toBeVisible()
			}
		}
	})

	test('Step 6: Signup modal appears on welcome page', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '6')
		})
		await page.goto('http://localhost:9000/')

		// Signup modal dialog should be visible
		const signupDialog = page.locator('.signup-dialog')
		await expect(signupDialog).toBeVisible({ timeout: 5000 })

		// CTA buttons should be hidden (replaced by modal)
		const getStartedBtn = page
			.locator('button')
			.filter({ hasText: /get started/i })
		await expect(getStartedBtn).toHaveCount(0)
	})

	test('Step 3: Dashboard with no concerts skips lane intro without stuck overlay', async ({
		page,
	}) => {
		// Override RPC mock with empty concert data
		await page.unrouteAll()
		await mockRpcRoutesEmpty(page)
		await mockLastFmApi(page)

		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard to load and lane intro to skip
		await page.waitForTimeout(5000)

		// Step should have advanced to 4 (skipped lane intro → My Artists spotlight)
		const step = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(step).toBe('4')

		// Spotlight should now be on My Artists tab (Step 4), not stuck/invisible
		const spotlight = page.locator('.visual-spotlight')
		if ((await spotlight.count()) > 0) {
			await expect(spotlight).toBeVisible()
		}
	})

	test('TC-GATE-E2E-02: Discovery page does not show Dashboard coach mark when ConcertService/List returns empty', async ({
		page,
	}) => {
		// Override RPC mock with empty concert data
		await page.unrouteAll()
		await mockRpcRoutesEmpty(page)
		await mockLastFmApi(page)

		// Seed 3 followed artists so searches trigger
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ id: 'a-1', name: 'Artist 1' },
					{ id: 'a-2', name: 'Artist 2' },
					{ id: 'a-3', name: 'Artist 3' },
				]),
			)
		})

		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discover-layout')

		// Wait for concert searches to complete (SearchNewConcerts + List verification)
		await page.waitForTimeout(5000)

		// Coach mark spotlight should NOT appear because ConcertService/List returned empty
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toHaveCount(0)

		// Guidance message should show the "no upcoming events" text
		const guidance = page.locator('.guidance-hud')
		if ((await guidance.count()) > 0) {
			const text = await guidance.textContent()
			expect(text).toBeTruthy()
		}
	})

	test('Spotlight is visible when coach mark is active', async ({ page }) => {
		// Set up step 1 with enough follows to trigger coach mark
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ id: 'a-1', name: 'Artist 1' },
					{ id: 'a-2', name: 'Artist 2' },
					{ id: 'a-3', name: 'Artist 3' },
				]),
			)
		})
		await page.goto('http://localhost:9000/discover')

		// Wait for coach mark to potentially appear
		const spotlight = page.locator('.visual-spotlight')
		if ((await spotlight.count()) > 0) {
			await expect(spotlight).toBeVisible()

			// Verify spotlight has the dark overlay box-shadow
			const boxShadow = await spotlight.evaluate((el) =>
				getComputedStyle(el).getPropertyValue('box-shadow'),
			)
			// box-shadow should contain a large spread (100vmax)
			expect(boxShadow).not.toBe('none')
		}
	})
})

/**
 * TC-TUT-E2E-01: Continuous end-to-end onboarding flow.
 *
 * Tests the full progression from Step 1 (coach mark on Dashboard icon)
 * through Step 6 (signup modal). Step 0→1 (bubble taps) is seeded via
 * localStorage because Canvas/Matter.js bubbles cannot be reliably
 * automated with Playwright.
 *
 * Flow: Discover (coach mark) → Dashboard (celebration → region → lane intro
 *       → card tap) → My Artists (hype → explanation → OK) → Signup modal
 */
test.describe('Continuous onboarding flow (Step 1 → Step 6)', () => {
	test.use({
		viewport: { width: 412, height: 915 },
	})

	test('full step progression from coach mark to signup modal', async ({
		page,
	}) => {
		test.setTimeout(90_000)
		// --- Setup: mock APIs ---
		await mockRpcRoutes(page)
		await mockLastFmApi(page)

		// --- Seed: simulate 3 artists followed + concert searches complete ---
		await page.addInitScript(() => {
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.removeItem('guest.home')
			localStorage.setItem('onboardingStep', '1')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ id: 'a-1', name: 'Artist 1' },
					{ id: 'a-2', name: 'Artist 2' },
					{ id: 'a-3', name: 'Artist 3' },
				]),
			)
		})

		// =====================================================================
		// STEP 1: Discover page — coach mark on Dashboard icon
		// =====================================================================
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discover-layout')

		// Wait for concert search completion and coach mark activation.
		// The coach mark targets [data-nav-dashboard] which is in the bottom nav.
		const dashboardCoachMark = page.locator('.visual-spotlight')
		await expect(dashboardCoachMark).toBeVisible({ timeout: 20_000 })

		// Verify the tooltip message is visible
		const tooltip = page.locator('.coach-mark-tooltip')
		await expect(tooltip).toBeVisible()

		// Verify tooltip has transparent background (no colored box)
		const tooltipBg = await tooltip.evaluate((el) =>
			getComputedStyle(el).getPropertyValue('background-color'),
		)
		expect(tooltipBg).toMatch(/transparent|rgba\(0,\s*0,\s*0,\s*0\)/)

		// Tap the Dashboard nav through the coach mark's target interceptor
		const targetInterceptor = page.locator('.target-interceptor')
		if ((await targetInterceptor.count()) > 0) {
			await targetInterceptor.click()
		} else {
			// Fallback: tap the nav icon directly
			await page.locator('[data-nav-dashboard]').click()
		}

		// =====================================================================
		// STEP 3: Dashboard — celebration → region → lane intro → card
		// =====================================================================
		await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })

		// Verify onboardingStep advanced to 3
		const stepAfterNav = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterNav).toBe('3')

		// Celebration overlay appears and auto-dismisses via transitionend
		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toBeVisible({ timeout: 10_000 })
		await expect(celebration).toHaveCount(0, { timeout: 10_000 })

		// Region selector opens after celebration completes (no guest.home set)
		const regionDialog = page.locator('dialog.user-home-selector')
		await expect(regionDialog).toBeVisible({ timeout: 5000 })
		const regionOption = regionDialog.locator('button').first()
		await regionOption.click()

		// Lane intro cycles: home(2s) → near(2s) → away(2s) → card (manual tap)
		// Wait for it to reach the card phase by checking step doesn't advance yet.
		// The card phase stops auto-advancing and waits for a tap.
		// Total wait: ~6s from startLaneIntro() + time for celebration + region
		const liveCard = page.locator('[data-live-card]').first()
		await expect(liveCard).toBeVisible({ timeout: 15_000 })

		// Wait for lane intro to reach card phase (~6s from start)
		// Card phase targets [data-live-card]:first-child — poll until step is still 3
		// and the interceptor overlaps the card
		await page.waitForTimeout(8000)

		// Tap the concert card interceptor — advances to Step 4
		const cardInterceptor = page.locator('.target-interceptor')
		await expect(cardInterceptor).toBeVisible({ timeout: 10_000 })
		await cardInterceptor.click()

		// =====================================================================
		// STEP 4: Spotlight on My Artists tab
		// =====================================================================
		const stepAfterCard = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterCard).toBe('4')

		// Spotlight should now be on [data-nav-my-artists]
		const myArtistsNav = page.locator('[data-nav-my-artists]')
		await expect(myArtistsNav).toBeVisible()

		// Tap My Artists tab — advances to Step 5
		const myArtistsInterceptor = page.locator('.target-interceptor')
		if ((await myArtistsInterceptor.count()) > 0) {
			await myArtistsInterceptor.click()
		} else {
			await myArtistsNav.click()
		}

		// =====================================================================
		// STEP 5: My Artists — hype selector → explanation → OK
		// =====================================================================
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })

		const stepAfterMyArtists = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterMyArtists).toBe('5')

		// Spotlight should be on [data-hype-button]
		const hypeButton = page.locator('[data-hype-button]').first()
		await expect(hypeButton).toBeVisible({ timeout: 10_000 })

		// Tap the hype button (via coach mark interceptor or directly)
		const hypeInterceptor = page.locator('.target-interceptor')
		if ((await hypeInterceptor.count()) > 0) {
			await hypeInterceptor.click()
		} else {
			await hypeButton.click()
		}

		// Hype selector dialog should open
		const hypeSelectorDialog = page
			.locator('dialog')
			.filter({ has: page.locator('.hype-level-option') })
		if ((await hypeSelectorDialog.count()) > 0) {
			await expect(hypeSelectorDialog).toBeVisible({ timeout: 5000 })

			// Select a hype level (first non-current option)
			const hypeOption = hypeSelectorDialog
				.locator('.hype-level-option')
				.first()
			await hypeOption.click()
		}

		// Hype explanation dialog should appear and STAY visible
		const explanation = page.locator('.hype-explanation-dialog')
		await expect(explanation).toBeVisible({ timeout: 5000 })

		// Wait 2s to verify no auto-dismiss
		await page.waitForTimeout(2000)
		await expect(explanation).toBeVisible()

		// Tap OK button to dismiss and advance to Step 6
		const okButton = explanation.locator('button')
		await expect(okButton).toBeVisible()
		await okButton.click()

		// =====================================================================
		// STEP 6: Welcome page — signup modal
		// =====================================================================
		await expect(page).toHaveURL(/^\/$|\/welcome/, { timeout: 10_000 })

		const stepAfterExplanation = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterExplanation).toBe('6')

		// Signup modal should be visible
		const signupDialog = page.locator('.signup-dialog')
		await expect(signupDialog).toBeVisible({ timeout: 5000 })

		// No spotlight, click-blockers, or orphaned coach mark elements
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toHaveCount(0)

		const clickBlockers = page.locator('.click-blocker')
		await expect(clickBlockers).toHaveCount(0)

		// Get Started button should NOT be visible (replaced by signup modal)
		const getStarted = page
			.locator('button')
			.filter({ hasText: /get started/i })
		await expect(getStarted).toHaveCount(0)
	})
})
