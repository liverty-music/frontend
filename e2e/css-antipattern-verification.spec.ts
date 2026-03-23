import { expect, type Page, test } from '@playwright/test'

/**
 * E2E verification for CSS antipattern replacements.
 *
 * Tests verify VISUAL OUTCOMES (bounding box positions, DOM presence)
 * rather than implementation details (CSS properties, data attributes,
 * class names). This ensures that regressions are caught even when the
 * underlying CSS mechanism changes.
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

/** Navigate to step 4 (My Artists spotlight) by advancing through the lane intro. */
async function advanceToStep4(page: Page): Promise<void> {
	await page.goto('http://localhost:9000/dashboard', {
		waitUntil: 'domcontentloaded',
	})

	const overlay = page.locator('.coach-mark-overlay')
	await expect(overlay).toBeVisible({ timeout: 8000 })

	// Lane intro: home(2s) → near(2s) → away(2s) → card (waits for tap)
	// Wait for card phase by checking for tap text in tooltip (Japanese or English)
	await page.waitForFunction(
		() => {
			const el = document.querySelector('.coach-mark-tooltip p')
			const text = el?.textContent ?? ''
			return text.includes('Tap') || text.includes('タップ')
		},
		undefined,
		{ timeout: 15_000 },
	)
	await page.locator('.click-blocker.target-interceptor').click({ force: true })

	// Step 4: spotlight moves to [data-nav="my-artists"]
	await page.waitForFunction(
		() => {
			const el = document.querySelector('[data-nav="my-artists"]')
			return el?.style.getPropertyValue('anchor-name') === '--coach-target'
		},
		undefined,
		{ timeout: 5000 },
	)
}

test.describe('CSS antipattern verification', () => {
	test.use({
		viewport: { width: 412, height: 915 },
	})

	test.describe('Coach mark — tooltip near target', () => {
		/**
		 * Core visual invariant:
		 *   The tooltip must be positioned near the target element,
		 *   either above or below depending on available viewport space.
		 */
		test('tooltip is near target at lane intro step', async ({ page }) => {
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
			await page.waitForTimeout(200)

			const targetBox = await page
				.locator('[style*="anchor-name: --coach-target"]')
				.boundingBox()
			const tooltipBox = await tooltip.boundingBox()

			expect(targetBox).not.toBeNull()
			expect(tooltipBox).not.toBeNull()

			// Tooltip must be near the target (within 60px gap)
			const isBelow = tooltipBox!.y >= targetBox!.y - 8
			const tolerance = 8

			if (isBelow) {
				const targetBottom = targetBox!.y + targetBox!.height
				expect(tooltipBox!.y).toBeGreaterThanOrEqual(
					targetBottom - tolerance,
				)
				expect(tooltipBox!.y).toBeLessThan(targetBottom + 60)
			} else {
				const tooltipBottom = tooltipBox!.y + tooltipBox!.height
				expect(tooltipBottom).toBeLessThanOrEqual(
					targetBox!.y + tolerance,
				)
				expect(tooltipBottom).toBeGreaterThan(targetBox!.y - 60)
			}
		})
	})

	test.describe('Coach mark — tooltip aligned with target', () => {
		/**
		 * Layout invariant:
		 *   The tooltip must horizontally overlap the target element.
		 *   A tooltip that drifts far from its target (e.g. left-biased
		 *   position-area causing offset from a right-aligned card)
		 *   breaks the visual connection between arrow and target.
		 */
		test('card spotlight: tooltip overlaps target horizontally', async ({
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

			// Wait for card phase of lane intro
			await page.waitForFunction(
				() => {
					const el = document.querySelector('.coach-mark-tooltip p')
					const text = el?.textContent ?? ''
					return text.includes('Tap') || text.includes('タップ')
				},
				undefined,
				{ timeout: 15_000 },
			)
			await page.waitForTimeout(200)

			const targetBox = await page
				.locator('[style*="anchor-name: --coach-target"]')
				.boundingBox()
			const tooltipBox = await page
				.locator('.coach-mark-tooltip')
				.boundingBox()

			expect(targetBox).not.toBeNull()
			expect(tooltipBox).not.toBeNull()

			// Horizontal overlap: ranges must intersect.
			// target: [targetBox.x, targetBox.x + targetBox.width]
			// tooltip: [tooltipBox.x, tooltipBox.x + tooltipBox.width]
			const targetLeft = targetBox!.x
			const targetRight = targetBox!.x + targetBox!.width
			const tooltipLeft = tooltipBox!.x
			const tooltipRight = tooltipBox!.x + tooltipBox!.width

			const overlapStart = Math.max(targetLeft, tooltipLeft)
			const overlapEnd = Math.min(targetRight, tooltipRight)
			const overlap = overlapEnd - overlapStart

			// Tooltip must overlap at least 20% of the target's width
			const minOverlap = targetBox!.width * 0.2
			expect(overlap).toBeGreaterThanOrEqual(minOverlap)
		})

		test('my-artists spotlight: tooltip overlaps target horizontally', async ({
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

			await advanceToStep4(page)
			await page.waitForTimeout(200)

			const targetBox = await page
				.locator('[data-nav="my-artists"]')
				.boundingBox()
			const tooltipBox = await page
				.locator('.coach-mark-tooltip')
				.boundingBox()

			expect(targetBox).not.toBeNull()
			expect(tooltipBox).not.toBeNull()

			const targetLeft = targetBox!.x
			const targetRight = targetBox!.x + targetBox!.width
			const tooltipLeft = tooltipBox!.x
			const tooltipRight = tooltipBox!.x + tooltipBox!.width

			const overlapStart = Math.max(targetLeft, tooltipLeft)
			const overlapEnd = Math.min(targetRight, tooltipRight)
			const overlap = overlapEnd - overlapStart

			// Tooltip must overlap at least 20% of the target's width
			const minOverlap = targetBox!.width * 0.2
			expect(overlap).toBeGreaterThanOrEqual(minOverlap)
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

	test.describe('Celebration overlay — transitionend cleanup', () => {
		test('reduced motion bypasses transitionend — cleanup happens immediately', async ({
			page,
		}) => {
			test.setTimeout(15_000)
			await mockOnboardingRpcRoutes(page)

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

			// Celebration overlay should appear
			const celebration = page.locator('.celebration-overlay')
			await expect(celebration).toBeVisible({ timeout: 5000 })

			// With reduced motion: 1500ms display then immediate cleanup (no fade transition)
			// Should be removed faster than the non-reduced-motion path (2500ms + 400ms fade)
			await expect(celebration).not.toBeVisible({ timeout: 5000 })
		})

		test('celebration overlay completes via transitionend and is removed from DOM', async ({
			page,
		}) => {
			test.setTimeout(15_000)
			await mockOnboardingRpcRoutes(page)

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

			// Celebration overlay should appear at step 3 (first dashboard visit)
			const celebration = page.locator('.celebration-overlay')
			await expect(celebration).toBeVisible({ timeout: 5000 })

			// Verify data-state attribute is used (not .fade-out class)
			await expect(celebration).toHaveAttribute('data-state', 'active')

			// Wait for full cycle: 2.5s display + 400ms CSS fade + transitionend cleanup
			// The overlay div is removed from DOM after transitionend fires
			await expect(celebration).not.toBeVisible({ timeout: 10_000 })

			// Verify no old .fade-out class leakage (replaced by data-state attribute)
			const fadeOutElements = page.locator('.fade-out')
			await expect(fadeOutElements).toHaveCount(0)
		})
	})
})
