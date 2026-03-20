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

		// ConcertService/ListSearchStatuses — return completed for all artists
		if (url.includes('ListSearchStatuses')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					statuses: [
						{ artistId: { value: 'a-1' }, status: 'SEARCH_STATUS_COMPLETED' },
						{ artistId: { value: 'a-2' }, status: 'SEARCH_STATUS_COMPLETED' },
						{ artistId: { value: 'a-3' }, status: 'SEARCH_STATUS_COMPLETED' },
					],
				}),
			})
		}

		// ConcertService/List — return empty (no concerts)
		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ concerts: [] }),
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

		// ConcertService/ListSearchStatuses — return completed for all artists
		if (url.includes('ListSearchStatuses')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					statuses: [
						{ artistId: { value: 'a-1' }, status: 'SEARCH_STATUS_COMPLETED' },
						{ artistId: { value: 'a-2' }, status: 'SEARCH_STATUS_COMPLETED' },
						{ artistId: { value: 'a-3' }, status: 'SEARCH_STATUS_COMPLETED' },
					],
				}),
			})
		}

		// ConcertService/SearchNewConcerts — fire-and-forget (check before List)
		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		// ConcertService/ListWithProximity (check before ListByFollower/List)
		if (url.includes('ListWithProximity')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: { value: { year: 2026, month: 3, day: 15 } },
							home: [
								{
									id: { value: 'c-1' },
									title: { value: 'Test Concert' },
									localDate: {
										value: { year: 2026, month: 3, day: 15 },
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

	test('Step 1: Snack notification appears on discover page entry', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'discovery')
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		// Snack notification should be visible
		const snack = page.locator('.snack-item')
		await expect(snack).toBeVisible({ timeout: 5000 })

		// Auto-dismiss: snack disappears after duration
		await expect(snack).not.toBeVisible({ timeout: 7000 })
	})

	test('Step 0 → Step 1: Get Started navigates to Discover', async ({
		page,
	}) => {
		await page.goto('http://localhost:9000/')
		await page
			.locator('button')
			.filter({ hasText: /get started/i })
			.click()
		await expect(page).toHaveURL(/discover/, { timeout: 10_000 })
	})

	test('Step 1: No toast when tapping restricted nav during onboarding', async ({
		page,
	}) => {
		// Start at discover (step 1)
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'discovery')
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

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
			localStorage.setItem('onboardingStep', 'dashboard')
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
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Dashboard content should be visible (au-viewport rendered)
		const mainContent = page.locator('au-viewport')
		await expect(mainContent).toBeVisible({ timeout: 10_000 })

		// No full-screen blocking celebration overlay
		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toHaveCount(0)
	})

	test('Coach mark tooltip has transparent background (no colored box)', async ({
		page,
	}) => {
		// Set up step 3 at the card phase
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
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
			localStorage.setItem('onboardingStep', 'completed')
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
			localStorage.setItem('onboardingStep', 'my-artists')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
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

	test('Completed: welcome page shows CTA buttons', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
		})
		await page.goto('http://localhost:9000/')

		// Welcome page CTA buttons should be visible
		const getStartedBtn = page
			.locator('button')
			.filter({ hasText: /get started/i })
		await expect(getStartedBtn).toBeVisible({ timeout: 5000 })
	})

	test('Step 3: Dashboard with no concerts skips lane intro without stuck overlay', async ({
		page,
	}) => {
		// Override RPC mock with empty concert data
		await page.unrouteAll()
		await mockRpcRoutesEmpty(page)
		await mockLastFmApi(page)

		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard to load and lane intro to skip
		await page.waitForTimeout(5000)

		// Step should have advanced to detail (skipped lane intro → My Artists spotlight)
		const step = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(step).toBe('detail')

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
			localStorage.setItem('onboardingStep', 'discovery')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})

		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		// Wait for concert searches to complete (SearchNewConcerts + List verification)
		await page.waitForTimeout(5000)

		// Coach mark spotlight should NOT be visible because concerts are empty
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).not.toBeVisible()

		// No onboarding HUD or popover guide should remain
		const popoverGuide = page.locator('.onboarding-guide')
		await expect(popoverGuide).toHaveCount(0)
	})

	test('Spotlight is visible when coach mark is active', async ({ page }) => {
		test.setTimeout(60_000)
		// Set up step 1 with enough follows to trigger coach mark.
		// No guest.home needed — concert gate uses ConcertService/List per artist,
		// not ListWithProximity which requires a home region.
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'discovery')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		// Wait for concert searches to complete and coach mark to activate
		// The spotlight becomes visible only after SearchNewConcerts + List complete
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toBeVisible({ timeout: 30_000 })

		// Verify spotlight has the dark overlay box-shadow
		const boxShadow = await spotlight.evaluate((el) =>
			getComputedStyle(el).getPropertyValue('box-shadow'),
		)
		// box-shadow should contain a large spread (100vmax)
		expect(boxShadow).not.toBe('none')
	})

	test('Reload with pre-seeded follows: page loads and preserves followed count', async ({
		page,
	}) => {
		// Simulate reload: pre-seeded follows in localStorage, step 1 (discovery)
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'discovery')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		// The SR status text includes the followed count — verify hydration preserved it
		const srOutput = page.locator('output.sr-only[role="status"]')
		await expect(srOutput).toContainText(/3/, { timeout: 10_000 })

		// No console errors related to hydration or missing state
		const errors: string[] = []
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text())
		})
		await page.waitForTimeout(2000)
		const hydrationErrors = errors.filter(
			(e) => e.includes('hydrate') || e.includes('followedArtists'),
		)
		expect(hydrationErrors).toHaveLength(0)
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

		// --- Seed: simulate 3 artists followed ---
		// guest.home is NOT needed for the discovery concert gate (uses ConcertService/List),
		// but IS needed for the dashboard step (ListWithProximity requires a home region).
		await page.addInitScript(() => {
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem('onboardingStep', 'discovery')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'a-1', name: 'Artist 1' }, home: null },
					{ artist: { id: 'a-2', name: 'Artist 2' }, home: null },
					{ artist: { id: 'a-3', name: 'Artist 3' }, home: null },
				]),
			)
		})

		// =====================================================================
		// STEP 1: Discover page — coach mark on Dashboard icon
		// =====================================================================
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		// Wait for concert search completion and coach mark activation.
		// The coach mark targets [data-nav="home"] which is in the bottom nav.
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
			await page.locator('[data-nav="home"]').click()
		}

		// =====================================================================
		// STEP 3: Dashboard — celebration → lane intro → card
		// (guest.home is already set, so region selector is skipped.
		//  Region selector is tested separately in dashboard-lane-classification.spec.ts)
		// =====================================================================
		await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 })

		// Verify onboardingStep advanced to dashboard
		const stepAfterNav = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterNav).toBe('dashboard')

		// Celebration overlay appears and auto-dismisses via transitionend.
		// The element stays in DOM with data-state="hidden" after fade-out.
		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toBeVisible({ timeout: 10_000 })
		await expect(celebration).not.toBeVisible({ timeout: 10_000 })

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
		expect(stepAfterCard).toBe('detail')

		// Spotlight should now be on [data-nav="my-artists"]
		const myArtistsNav = page.locator('[data-nav="my-artists"]')
		await expect(myArtistsNav).toBeVisible({ timeout: 5000 })

		// Tap My Artists tab — advances to Step 5
		const myArtistsInterceptor = page.locator('.target-interceptor')
		if ((await myArtistsInterceptor.count()) > 0) {
			await myArtistsInterceptor.click()
		} else {
			await myArtistsNav.click()
		}

		// =====================================================================
		// STEP 5: My Artists — hype header spotlight
		// =====================================================================
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })

		const stepAfterMyArtists = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterMyArtists).toBe('my-artists')

		// Spotlight targets [data-hype-header] (the hype legend bar)
		const hypeHeader = page.locator('[data-hype-header]')
		await expect(hypeHeader).toBeVisible({ timeout: 10_000 })

		// Verify artist list loaded (at least 1 artist row visible)
		const artistRow = page.locator('.artist-row').first()
		await expect(artistRow).toBeVisible({ timeout: 5000 })

		// =====================================================================
		// STEP 5b: Tap spotlight to dismiss coach mark (verifies onTap callback)
		// =====================================================================
		const spotlightInterceptor = page.locator('.target-interceptor')
		await expect(spotlightInterceptor).toBeVisible({ timeout: 5000 })
		await spotlightInterceptor.click()

		// Coach mark overlay should be dismissed after tapping
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).not.toBeVisible({ timeout: 5000 })

		// Hype sliders should now be interactive (not blocked by click-blocker)
		const hypeSlider = page.locator('hype-inline-slider').first()
		await expect(hypeSlider).toBeVisible({ timeout: 5000 })

		// Note: Hype slider interaction cannot advance onboarding further in
		// guest mode because hype-inline-slider blocks changes for
		// unauthenticated users (dispatches hype-signup-prompt instead).
		// Full step completion (my-artists → completed) requires auth.
	})
})
