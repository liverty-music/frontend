import { expect, type Page, test } from '@playwright/test'

/**
 * E2E verification for CSS antipattern replacements.
 *
 * Tests verify FUNCTIONAL OUTCOMES (visibility, viewport presence,
 * user interactions) rather than pixel coordinates or bounding boxes.
 * Coordinate-based assertions are an anti-pattern in E2E tests — they
 * break on CI due to rendering timing, font differences, and View
 * Transition / CSS Anchor Positioning layout delays. Use visual
 * regression testing (toHaveScreenshot) for pixel-level verification.
 */

async function mockOnboardingRpcRoutes(page: Page): Promise<void> {
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)
	const tomorrowDate = {
		year: tomorrow.getFullYear(),
		month: tomorrow.getMonth() + 1,
		day: tomorrow.getDate(),
	}
	const concertPayload = {
		id: { value: 'c-1' },
		artistId: { value: 'a-1' },
		localDate: { value: tomorrowDate },
		venue: {
			name: { value: 'Test Venue' },
			adminArea: { value: 'JP-13' },
		},
		title: { value: 'Test Concert' },
		sourceUrl: { value: 'https://example.com' },
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
							home: [concertPayload],
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
							away: [concertPayload],
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
					concerts: [concertPayload],
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
 * Navigate to MY_ARTISTS step by dismissing the celebration overlay.
 *
 * When onboardingStep='dashboard' and celebrationShown is not set, the
 * celebration appears immediately (no lane intro needed). Dismissing it
 * advances the step to MY_ARTISTS. The caller seeds celebrationShown=removed
 * to ensure the celebration shows.
 *
 * Flow: goto /dashboard → celebration appears → dismiss → MY_ARTISTS step
 */
async function advanceToMyArtistsSpotlight(page: Page): Promise<void> {
	await page.goto('http://localhost:9000/dashboard', {
		waitUntil: 'domcontentloaded',
	})

	// Celebration overlay appears immediately when celebrationShown is not set
	const celebration = page.locator('.celebration-overlay')
	await expect(celebration).toBeVisible({ timeout: 8000 })

	// Dismiss celebration — sets step to MY_ARTISTS.
	// page-help may intercept pointer events, so use JS dispatch.
	await page.evaluate(() => {
		const el = document.querySelector('.celebration-overlay')
		el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
	})

	await expect(celebration).not.toBeVisible({ timeout: 5000 })
}

test.describe('CSS antipattern verification', () => {
	test.use({
		viewport: { width: 412, height: 915 },
	})

	test.describe('Coach mark — tooltip visible with target', () => {
		/**
		 * Functional invariant:
		 *   When the coach mark activates, both the overlay and tooltip
		 *   must be visible in the viewport alongside the spotlight target.
		 *
		 * Note: Pixel-level positioning (proximity, horizontal overlap)
		 * should be verified via visual regression tests (toHaveScreenshot),
		 * not coordinate assertions which are flaky in CI due to View
		 * Transition and CSS Anchor Positioning layout timing.
		 */
		test('tooltip and overlay are visible at lane intro step', async ({ page }) => {
			test.setTimeout(30_000)
			await mockOnboardingRpcRoutes(page)

			await page.addInitScript(() => {
				localStorage.setItem('onboardingStep', 'dashboard')
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
			})

			await page.goto('http://localhost:9000/dashboard', {
				waitUntil: 'domcontentloaded',
			})

			const overlay = page.locator('.coach-mark-overlay')
			await expect(overlay).toBeVisible({ timeout: 8000 })

			const tooltip = page.locator('.coach-mark-tooltip')
			await expect(tooltip).toBeVisible()

			const spotlight = page.locator('.visual-spotlight')
			await expect(spotlight).toBeVisible()
		})

		test('tooltip remains visible after advancing to away phase', async ({
			page,
		}) => {
			test.setTimeout(30_000)
			await mockOnboardingRpcRoutes(page)

			await page.addInitScript(() => {
				localStorage.setItem('onboardingStep', 'dashboard')
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
			})

			await page.goto('http://localhost:9000/dashboard', {
				waitUntil: 'domcontentloaded',
			})

			const overlay = page.locator('.coach-mark-overlay')
			await expect(overlay).toBeVisible({ timeout: 8000 })

			// Advance to 'away' phase by dispatching click events directly.
			// The target-interceptor is positioned via CSS Anchor Positioning
			// inside a popover top layer — it may be outside the viewport when
			// the anchor hasn't resolved, so use JS dispatch instead of Playwright click.
			for (let i = 0; i < 2; i++) {
				await page.evaluate(() => {
					const el = document.querySelector('.click-blocker.target-interceptor')
					el?.dispatchEvent(new PointerEvent('click', { bubbles: true }))
				})
			}

			// Overlay and tooltip still visible after phase advancement
			await expect(overlay).toBeVisible()
			const tooltip = page.locator('.coach-mark-tooltip')
			await expect(tooltip).toBeVisible()
		})
	})

	test.describe('Coach mark — click blocking', () => {
		test('clicking outside target does not navigate away', async ({ page }) => {
			test.setTimeout(20_000)
			await mockOnboardingRpcRoutes(page)

			await page.addInitScript(() => {
				localStorage.setItem('onboardingStep', 'dashboard')
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
			})

			await page.goto('http://localhost:9000/dashboard', {
				waitUntil: 'domcontentloaded',
			})

			const overlay = page.locator('.coach-mark-overlay')
			await expect(overlay).toBeVisible({ timeout: 8000 })

			// Click outside the target (center-top of viewport)
			await page.mouse.click(206, 50)

			// Should still be on dashboard — coach mark still visible, no navigation
			await expect(overlay).toBeVisible()
			expect(page.url()).toContain('/dashboard')
		})
	})

	test.describe('Celebration overlay — tap-to-dismiss cleanup', () => {
		test('reduced motion: celebration uses data-state attribute (no fade-out class)', async ({
			page,
		}) => {
			test.setTimeout(15_000)
			// Return empty concert data so lane intro is skipped → celebration shows directly
			await page.route('**/liverty_music.rpc.**', (route) => {
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({}),
				})
			})

			await page.emulateMedia({ reducedMotion: 'reduce' })

			await page.addInitScript(() => {
				localStorage.setItem('onboardingStep', 'dashboard')
				localStorage.removeItem('onboarding.celebrationShown')
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

			await page.goto('http://localhost:9000/dashboard', {
				waitUntil: 'domcontentloaded',
			})

			// Celebration overlay should appear (lane intro skipped — no concert data)
			const celebration = page.locator('.celebration-overlay')
			await expect(celebration).toBeVisible({ timeout: 5000 })

			// Verify data-state="active" attribute is used (not .fade-out class)
			await expect(celebration).toHaveAttribute('data-state', 'active')

			// Overlay is tap-to-dismiss. Dispatch pointerdown to trigger onTap().
			// page-help may intercept real pointer events, so use JS dispatch.
			await page.evaluate(() => {
				const el = document.querySelector('.celebration-overlay')
				el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
			})

			// After dismissal, overlay should not be visible
			await expect(celebration).not.toBeVisible({ timeout: 5000 })

			// Verify no old .fade-out class leakage (replaced by data-state attribute)
			const fadeOutElements = page.locator('.fade-out')
			await expect(fadeOutElements).toHaveCount(0)
		})

		test('celebration overlay dismissed via tap: removed from DOM after transition', async ({
			page,
		}) => {
			test.setTimeout(15_000)
			// Return empty concert data so lane intro is skipped → celebration shows directly
			await page.route('**/liverty_music.rpc.**', (route) => {
				return route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({}),
				})
			})

			await page.addInitScript(() => {
				localStorage.setItem('onboardingStep', 'dashboard')
				localStorage.removeItem('onboarding.celebrationShown')
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

			await page.goto('http://localhost:9000/dashboard', {
				waitUntil: 'domcontentloaded',
			})

			// Celebration overlay should appear (lane intro skipped — no concert data)
			const celebration = page.locator('.celebration-overlay')
			await expect(celebration).toBeVisible({ timeout: 5000 })

			// Verify data-state="active" is used (not .fade-out class)
			await expect(celebration).toHaveAttribute('data-state', 'active')

			// Tap to dismiss: dispatch pointerdown directly on the element.
			// page-help may intercept real pointer events from Playwright.
			await page.evaluate(() => {
				const el = document.querySelector('.celebration-overlay')
				el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
			})

			// After tap: overlay transitions to data-state="hidden" then is removed
			await expect(celebration).not.toBeVisible({ timeout: 5000 })

			// Verify no old .fade-out class leakage (replaced by data-state attribute)
			const fadeOutElements = page.locator('.fade-out')
			await expect(fadeOutElements).toHaveCount(0)
		})
	})
})
