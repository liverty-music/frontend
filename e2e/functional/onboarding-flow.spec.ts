import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for the onboarding tutorial flow.
 *
 * New step sequence (DETAIL step removed):
 *   LP → DISCOVERY → DASHBOARD → MY_ARTISTS → COMPLETED
 *
 * Key behavioral changes:
 * - Celebration overlay is tap-to-dismiss (no auto-timer)
 * - onCelebrationOpen() advances step to MY_ARTISTS immediately
 * - After celebration dismiss, user freely navigates to My Artists tab
 * - My Artists: hype change completes onboarding (no explanation dialog)
 * - Discovery coach mark auto-fades after 2s; must be tapped quickly
 */

// ---------------------------------------------------------------------------
// RPC mocks
// ---------------------------------------------------------------------------

/** Mock all Connect-RPC requests with empty concert data. */
async function mockRpcRoutesEmpty(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ concerts: [] }),
			})
		}

		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ concerts: [] }),
			})
		}

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{ id: { value: 'a-1' }, name: { value: 'Artist 1' }, hype: 'watch' },
						{ id: { value: 'a-2' }, name: { value: 'Artist 2' }, hype: 'watch' },
						{ id: { value: 'a-3' }, name: { value: 'Artist 3' }, hype: 'watch' },
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
 * Mock Connect-RPC with concert data.
 * - ConcertService/List: returns 1 concert per artist (triggers showDashboardCoachMark)
 * - ListWithProximity: returns concerts in the away lane
 * - ListFollowed: returns 3 followed artists
 */
async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					concerts: [
						{
							id: { value: 'c-1' },
							title: { value: 'Test Concert' },
							localDate: { value: { year: 2026, month: 6, day: 15 } },
						},
					],
				}),
			})
		}

		if (url.includes('ListWithProximity')) {
			// Return concerts for 5+ artists to satisfy PREVIEW_MIN_ARTISTS_WITH_CONCERTS
			const artists = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: artists.map((aid, i) => ({
						date: { value: { year: 2026, month: 6, day: 15 + i } },
						home: [],
						nearby: [],
						away: [
							{
								id: { value: `c-${aid}` },
								artistId: { value: aid },
								title: { value: `Concert ${aid}` },
								localDate: {
									value: { year: 2026, month: 6, day: 15 + i },
								},
								venue: {
									name: { value: `Venue ${aid}` },
									adminArea: { value: 'JP-13' },
								},
							},
						],
					})),
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
							date: { value: { year: 2026, month: 6, day: 15 } },
							away: [
								{
									id: { value: 'c-1' },
									title: { value: 'Test Concert' },
									localDate: { value: { year: 2026, month: 6, day: 15 } },
								},
							],
						},
					],
				}),
			})
		}

		// ConcertService/List — returns 1 concert per artist
		// This is what makes concertService.artistsWithConcertsCount >= 3,
		// which triggers showDashboardCoachMark = true
		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					concerts: [
						{
							id: { value: 'c-1' },
							title: { value: 'Test Concert' },
							localDate: { value: { year: 2026, month: 6, day: 15 } },
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
						{ id: { value: 'a-1' }, name: { value: 'Artist 1' }, hype: 'watch' },
						{ id: { value: 'a-2' }, name: { value: 'Artist 2' }, hype: 'watch' },
						{ id: { value: 'a-3' }, name: { value: 'Artist 3' }, hype: 'watch' },
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

/** Last.fm API mock — returns 10 artists for geo.gettopartists, empty similar. */
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
				body: JSON.stringify({ similarartists: { artist: [] } }),
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
 * Dismiss the celebration overlay by dispatching a pointerdown event directly
 * on the element. Necessary because page-help floats above the overlay and
 * intercepts actual pointer events from Playwright.
 */
async function dismissCelebration(page: Page): Promise<void> {
	await page.evaluate(() => {
		const el = document.querySelector('.celebration-overlay')
		el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
	})
}

// ---------------------------------------------------------------------------
// Test suite: individual step / scenario tests
// ---------------------------------------------------------------------------

test.describe('Onboarding tutorial flow', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.removeItem('onboardingStep')
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.removeItem('guest.home')
			localStorage.removeItem('guest.followedArtists')
		})
		await mockRpcRoutes(page)
		await mockLastFmApi(page)
	})

	// -------------------------------------------------------------------------
	// LP (Step 0)
	// -------------------------------------------------------------------------

	test('Step 0: Welcome page shows Get Started button', async ({ page }) => {
		await page.goto('http://localhost:9000/')
		await expect(
			page.locator('button').filter({ hasText: /get started/i }).first(),
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
		await expect(page).toHaveURL(/discover/, { timeout: 10_000 })
	})

	test('Completed: welcome page still shows Get Started button', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
		})
		await page.goto('http://localhost:9000/')
		await expect(
			page.locator('button').filter({ hasText: /get started/i }).first(),
		).toBeVisible({ timeout: 5000 })
	})

	test('Step 0: Dashboard preview renders when concert data is available', async ({
		page,
	}) => {
		// mockRpcRoutes (via beforeEach) returns concerts for ConcertService/List.
		// loadPreviewConcerts iterates PREVIEW_ARTIST_IDS and stops after ≥3 artists
		// return concerts. The preview section only renders when previewDateGroups.length > 0.
		await page.goto('http://localhost:9000/')

		// Preview section is present in DOM (in scroll-snap Screen 2)
		const preview = page.locator('[data-testid="welcome-preview"]')
		await expect(preview).toBeAttached({ timeout: 10_000 })

		// Scroll to Screen 2 to make preview visible
		await preview.scrollIntoViewIfNeeded()

		// At least one event card rendered inside the preview
		const cards = preview.locator('event-card')
		await expect(cards.first()).toBeVisible({ timeout: 15_000 })
	})

	test('Step 0: Dashboard preview is hidden when no concert data', async ({
		page,
	}) => {
		// Override the default mock to return empty concerts for all ConcertService/List calls.
		// This simulates the case where no preview artists have upcoming concerts.
		await page.route('**/liverty_music.rpc.**', (route) => {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		})

		await page.goto('http://localhost:9000/')

		// Get Started button still visible — page loads normally
		await expect(
			page.locator('button').filter({ hasText: /get started/i }).first(),
		).toBeVisible({ timeout: 5000 })

		// Preview section must not be in the DOM (if.bind="previewDateGroups.length > 0")
		await expect(page.locator('[data-testid="welcome-preview"]')).not.toBeAttached()
	})

	// -------------------------------------------------------------------------
	// DISCOVERY (Step 1)
	// -------------------------------------------------------------------------

	test('Step 1: No popover-guide snack on discover page entry', async ({
		page,
	}) => {
		// The popoverGuide snack was removed in refine-onboarding
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'discovery')
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		await page.waitForLoadState('networkidle')
		await expect(page.locator('.snack-item')).toHaveCount(0)
	})

	test('Step 1: No toast when tapping restricted nav during onboarding', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'discovery')
		})
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		const ticketsNav = page.locator('[data-nav-tickets]')
		if ((await ticketsNav.count()) > 0) {
			await ticketsNav.click()
			// Web-first assertion: if a toast were to appear, it would within 500ms
			await expect(
				page.locator('.toast-message').filter({ hasText: /login/i }),
			).toHaveCount(0, { timeout: 1000 })
		}
	})

	test('TC-GATE-E2E-02: No coach mark when ConcertService/List returns empty', async ({
		page,
	}) => {
		await page.unrouteAll()
		await mockRpcRoutesEmpty(page)
		await mockLastFmApi(page)

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

		// Wait for all concert searches to complete, then verify no coach mark
		await page.waitForLoadState('networkidle')
		await expect(page.locator('.visual-spotlight')).not.toBeVisible({ timeout: 3000 })
		await expect(page.locator('.onboarding-guide')).toHaveCount(0)
	})

	test('Spotlight appears when 3 artists have concert data', async ({
		page,
	}) => {
		test.setTimeout(60_000)
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

		// Coach mark auto-fades after 2s — must detect before fade
		const spotlight = page.locator('.visual-spotlight')
		await expect(spotlight).toBeVisible({ timeout: 30_000 })

		// Verify box-shadow (dark overlay) is applied
		const boxShadow = await spotlight.evaluate(
			(el) => getComputedStyle(el).boxShadow,
		)
		expect(boxShadow).not.toBe('none')
	})

	test('Reload with pre-seeded follows preserves followed count', async ({
		page,
	}) => {
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

		// SR status includes followed count
		const srOutput = page.locator('output.sr-only[role="status"]')
		await expect(srOutput).toContainText(/3/, { timeout: 10_000 })
	})

	// -------------------------------------------------------------------------
	// DASHBOARD (Step 3)
	// -------------------------------------------------------------------------

	test('Step 3: Celebration does not replay after page reload', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		await expect(page.locator('.celebration-overlay')).toHaveCount(0)
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

		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })
		await expect(page.locator('.celebration-overlay')).toHaveCount(0)
	})

	test('Step 3: Celebration appears and can be tap-dismissed', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toBeVisible({ timeout: 10_000 })

		// onCelebrationOpen fires immediately — step already MY_ARTISTS
		const stepAfterOpen = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterOpen).toBe('my-artists')

		// Tap to dismiss (page-help intercepts pointer events, use JS dispatch)
		await dismissCelebration(page)
		await expect(celebration).not.toBeVisible({ timeout: 10_000 })

		// Dashboard is interactive after dismiss
		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 5000 })
	})

	test('Step 3: Dashboard with no concerts shows tap-to-dismiss celebration', async ({
		page,
	}) => {
		await page.unrouteAll()
		await mockRpcRoutesEmpty(page)
		await mockLastFmApi(page)

		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.removeItem('onboarding.celebrationShown')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toBeVisible({ timeout: 10_000 })

		await dismissCelebration(page)
		await expect(celebration).not.toBeVisible({ timeout: 10_000 })

		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 5000 })
	})

	test('Coach mark tooltip has transparent background (no colored box)', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('http://localhost:9000/dashboard')

		const tooltip = page.locator('.coach-mark-tooltip')
		if ((await tooltip.count()) > 0) {
			const bg = await tooltip.evaluate(
				(el) => getComputedStyle(el).backgroundColor,
			)
			expect(bg).not.toMatch(/rgb\(255,\s*255,\s*255\)/)
		}
	})

	test('Toast popover has no white background gap', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
		})
		await page.goto('http://localhost:9000/dashboard')

		await page.evaluate(() => {
			const popover = document.querySelector('[popover].toast-popover')
			if (popover) {
				const style = getComputedStyle(popover)
				if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
					throw new Error(
						`Toast popover has non-transparent background: ${style.backgroundColor}`,
					)
				}
			}
		})
	})

	// -------------------------------------------------------------------------
	// MY_ARTISTS (Step 5)
	// -------------------------------------------------------------------------

	test('Step 5: My Artists page loads and hype change has no dialog', async ({
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
		await page.waitForSelector('my-artists-route', { timeout: 10_000 })

		// Hype dots are visible in the artist table
		await expect(page.locator('[data-artist-rows]')).toBeVisible({
			timeout: 5000,
		})

		// Trigger hype change by dispatching 'change' on the 'home' radio (index 1).
		// Aurelia's change.trigger calls onHypeInput(artist, 'home') from binding scope.
		// click({ force: true }) doesn't fire 'change' on visually-hidden inputs;
		// direct dispatchEvent is the reliable path for hidden form controls.
		const hypeRadios = page.locator('input[type="radio"][name^="hype-"]')
		await expect(hypeRadios.first()).toBeAttached({ timeout: 5000 })
		await page.evaluate(() => {
			const radio = document.querySelectorAll<HTMLInputElement>(
				'input[type="radio"][name^="hype-"]',
			)[1]
			if (!radio) throw new Error('hype radio not found')
			radio.dispatchEvent(new Event('change', { bubbles: true }))
		})

		// No hype-notification dialog (component was removed)
		await expect(page.locator('.hype-notification-dialog')).toHaveCount(0)

		// Step advances to completed
		await expect
			.poll(
				() => page.evaluate(() => localStorage.getItem('onboardingStep')),
				{ timeout: 5000 },
			)
			.toBe('completed')
	})
})

// ---------------------------------------------------------------------------
// TC-TUT-E2E-01: Continuous end-to-end onboarding flow
// ---------------------------------------------------------------------------

/**
 * Full step progression from DISCOVERY coach mark to onboarding completion.
 *
 * New flow (DETAIL step removed):
 *   DISCOVERY (coach mark → tap) →
 *   DASHBOARD (celebration open → MY_ARTISTS set → tap dismiss) →
 *   freely navigate to MY_ARTISTS tab →
 *   MY_ARTISTS (hype change → COMPLETED)
 *
 * Key design decisions:
 * - Discovery coach mark auto-fades in 2s — use waitForFunction to detect
 *   the moment it appears, then immediately tap via JS to avoid race
 * - Celebration overlay: page-help intercepts pointer events from Playwright;
 *   use dispatchEvent(pointerdown) to trigger onTap() directly
 * - After celebration dismiss, no coach mark guides user to My Artists —
 *   it's free exploration; test clicks the nav tab directly
 * - My Artists has no spotlight/interceptor; hype radio change completes onboarding
 */
test.describe('Continuous onboarding flow (Step 1 → completed)', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test('full step progression from discovery to onboarding completion', async ({
		page,
	}) => {
		test.setTimeout(90_000)

		await mockRpcRoutes(page)
		await mockLastFmApi(page)

		// Seed: 3 artists followed, home set (needed for ListWithProximity on dashboard)
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

		// =========================================================================
		// STEP 1 — DISCOVERY: wait for coach mark to appear, then simulate tap
		// The coach mark fades after 2s (COACH_MARK_FADE_MS). All 3 artists'
		// concert searches run concurrently against the mock, so they complete
		// fast. We wait for the spotlight to become visible (proves coach mark
		// fired), then advance step directly via localStorage + navigate.
		//
		// Why not dispatch click on .target-interceptor?
		// The target-interceptor lives inside a dialog[popover] in the top layer.
		// Aurelia's click.trigger listener doesn't reliably receive synthetic
		// events dispatched into the top layer from outside. Instead, we simulate
		// what onCoachMarkTap() does: setStep(DASHBOARD) + router.load('/dashboard').
		// =========================================================================
		await page.goto('http://localhost:9000/discover')
		await page.waitForSelector('.discovery-layout')

		// Wait for spotlight to become visible (concert searches must complete first)
		await page.waitForFunction(
			() => {
				const el = document.querySelector('.visual-spotlight')
				if (!el) return false
				const style = getComputedStyle(el)
				return style.visibility !== 'hidden' && style.display !== 'none'
			},
			{ timeout: 30_000 },
		)

		// Simulate onCoachMarkTap(): advance step to DASHBOARD and navigate.
		//
		// The challenge: we cannot update in-memory OnboardingService state via
		// localStorage. page.goto triggers the Aurelia router as a SPA navigation
		// (not a full reload), so it redirects back to /discovery based on the
		// in-memory step value.
		//
		// Fix: add an initScript that seeds step='dashboard' — addInitScript
		// runs on the NEXT full page load. Then force a full reload by navigating
		// to the absolute URL, which triggers a fresh HTTP request and Aurelia
		// reinitializes from localStorage (reading 'dashboard').
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
		})
		// page.goto with absolute URL forces a new HTTP request + full page load
		await page.goto('http://localhost:9000/dashboard')
		await page.waitForURL(/dashboard/, { timeout: 10_000 })

		// =========================================================================
		// STEP 3 — DASHBOARD: lane intro → celebration → dismiss
		// =========================================================================

		// Lane intro starts: HOME → NEAR → AWAY spotlight sequence.
		// The target-interceptor is inside a popover top layer positioned via
		// CSS Anchor Positioning — it may be outside the viewport when the
		// anchor hasn't resolved, so dispatch click via JS instead of Playwright click.
		const coachOverlay = page.locator('.coach-mark-overlay')
		await expect(coachOverlay).toBeVisible({ timeout: 10_000 })
		for (const _phase of ['home', 'near', 'away']) {
			await page.evaluate(() => {
				const el = document.querySelector('coach-mark .target-interceptor')
				el?.dispatchEvent(new PointerEvent('click', { bubbles: true }))
			})
		}

		// After AWAY phase tap, celebration opens (step → MY_ARTISTS)
		const celebration = page.locator('.celebration-overlay')
		await expect(celebration).toBeVisible({ timeout: 10_000 })

		const stepAfterCelebOpen = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAfterCelebOpen).toBe('my-artists')

		// Dismiss: page-help intercepts pointer events, so use JS dispatch
		await dismissCelebration(page)
		await expect(celebration).not.toBeVisible({ timeout: 10_000 })

		// =========================================================================
		// STEP 5 — MY_ARTISTS: free navigation via SPA nav tab click
		// After celebration dismiss, the coach mark overlay is deactivated and
		// nav tabs are un-dimmed. We click the My Artists nav tab to trigger
		// Aurelia's SPA navigation — this preserves in-memory OnboardingService
		// state (step = MY_ARTISTS set by onCelebrationOpen). page.goto would
		// trigger a full reload + addInitScript re-run, resetting step to 'dashboard'.
		//
		// The page-help bottom sheet auto-opens on the dashboard page, covering
		// the nav tab. We dispatch a click via JS to bypass the bottom sheet.
		// =========================================================================
		await page.evaluate(() => {
			const tab = document.querySelector<HTMLElement>('[data-nav="my-artists"]')
			tab?.click()
		})
		await expect(page).toHaveURL(/my-artists/, { timeout: 10_000 })

		// Verify step is still MY_ARTISTS (not reverted)
		const stepAtMyArtists = await page.evaluate(() =>
			localStorage.getItem('onboardingStep'),
		)
		expect(stepAtMyArtists).toBe('my-artists')

		// Artist table loads
		await expect(page.locator('[data-artist-rows]')).toBeVisible({
			timeout: 10_000,
		})
		await expect(page.locator('.artist-row').first()).toBeVisible({
			timeout: 5000,
		})

		// =========================================================================
		// STEP 5 → COMPLETED: hype change completes onboarding
		// checked.bind="artist.hype" + model.bind="level" creates a two-way binding:
		// clicking the 'home' radio (index 1) sets artist.hype = 'home', then
		// change.trigger calls onHypeInput which detects the change and advances
		// onboarding to COMPLETED. force: true bypasses the visually-hidden clip-path.
		// =========================================================================
		const hypeRadios = page.locator('input[type="radio"][name^="hype-"]')
		await expect(hypeRadios.first()).toBeAttached({ timeout: 5000 })

		// Dispatch 'change' on the 'home' radio (index 1) for the first artist.
		// click({ force: true }) doesn't fire 'change' on visually-hidden inputs.
		// Aurelia's change.trigger calls onHypeInput(artist, 'home') from the binding scope.
		await page.evaluate(() => {
			const radio = document.querySelectorAll<HTMLInputElement>(
				'input[type="radio"][name^="hype-"]',
			)[1]
			if (!radio) throw new Error('hype radio not found')
			radio.dispatchEvent(new Event('change', { bubbles: true }))
		})

		// Onboarding step advances to completed
		await expect
			.poll(
				() =>
					page.evaluate(() => localStorage.getItem('onboardingStep')),
				{ timeout: 5000 },
			)
			.toBe('completed')

		// Hype change is accepted (no dialog, no revert)
		await expect(page.locator('.hype-notification-dialog')).toHaveCount(0)
	})
})
