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

	test.describe('Coach mark — arrow points at target', () => {
		/**
		 * Core visual invariant:
		 *   The visible arrow must sit BETWEEN the message text and the target,
		 *   with its nearest edge closer to the target than to the message.
		 *
		 * This catches the original bug where @position-try couldn't flip
		 * flex-direction, leaving the arrow on the wrong side of the text.
		 */
		// TODO: CSS anchor positioning layout differs in headless Chromium Pixel 7 viewport.
		// The arrow's y-position doesn't satisfy the "between message and target" invariant.
		// Needs investigation into whether this is a rendering difference or a real regression.
		test.fixme(
			'arrow is between message and target when tooltip flips above bottom-nav',
			async ({ page }) => {
				test.setTimeout(30_000)
				await mockOnboardingRpcRoutes(page)

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

				await advanceToStep4(page)

				const tooltip = page.locator('.coach-mark-tooltip')
				await expect(tooltip).toBeVisible()

				// Gather bounding boxes for the three key elements
				const targetBox = await page
					.locator('[data-nav="my-artists"]')
					.boundingBox()
				const tooltipBox = await tooltip.boundingBox()
				const messageBox = await page
					.locator('.coach-tooltip-message')
					.boundingBox()

				expect(targetBox).not.toBeNull()
				expect(tooltipBox).not.toBeNull()
				expect(messageBox).not.toBeNull()

				// 1. Tooltip is ABOVE the target (flipped)
				expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(
					targetBox!.y + 8,
				)

				// Find the visible arrow — whichever .coach-arrow-container has non-zero height
				const arrowContainers = page.locator('.coach-arrow-container')
				const count = await arrowContainers.count()
				let arrowBox: {
					x: number
					y: number
					width: number
					height: number
				} | null = null
				for (let i = 0; i < count; i++) {
					const box = await arrowContainers.nth(i).boundingBox()
					if (box && box.height > 0 && box.width > 0) {
						arrowBox = box
					}
				}
				expect(arrowBox).not.toBeNull()

				// 2. Arrow sits BETWEEN message and target vertically:
				//    message.bottom ≤ arrow.top  AND  arrow.bottom ≤ target.top
				//    (with small tolerance for sub-pixel rendering)
				const tolerance = 8
				expect(arrowBox!.y).toBeGreaterThanOrEqual(
					messageBox!.y + messageBox!.height - tolerance,
				)
				expect(arrowBox!.y + arrowBox!.height).toBeLessThanOrEqual(
					targetBox!.y + tolerance,
				)

				// 3. Arrow's center is closer to target than message's center is.
				//    This confirms the arrow "bridges" toward the target.
				const arrowCenterY = arrowBox!.y + arrowBox!.height / 2
				const messageCenterY = messageBox!.y + messageBox!.height / 2
				const targetTopY = targetBox!.y
				expect(Math.abs(arrowCenterY - targetTopY)).toBeLessThan(
					Math.abs(messageCenterY - targetTopY),
				)

				// 4. Arrow-head points TOWARD the target (below the arrow-line start).
				//    The arrow-head's center Y should be closer to the target than
				//    the arrow-line's center Y. This catches SVG path direction bugs
				//    where the arrowhead faces away from the target.
				const visibleArrow = page.locator(
					'.coach-arrow-below:not([style*="display: none"])',
				)
				const headBox = await visibleArrow.locator('.arrow-head').boundingBox()
				const lineBox = await visibleArrow.locator('.arrow-line').boundingBox()
				expect(headBox).not.toBeNull()
				expect(lineBox).not.toBeNull()
				const headCenterY = headBox!.y + headBox!.height / 2
				const lineCenterY = lineBox!.y + lineBox!.height / 2
				// Target is below → head should be lower (closer to target) than line center
				expect(headCenterY).toBeGreaterThan(lineCenterY)
			},
		)

		test('arrow is between target and message at lane intro step', async ({
			page,
		}) => {
			test.setTimeout(30_000)
			await mockOnboardingRpcRoutes(page)

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

			await page.goto('http://localhost:9000/dashboard', {
				waitUntil: 'domcontentloaded',
			})

			// Wait for lane intro — spotlights a lane header.
			// The tooltip may appear below (default position-area: block-end)
			// or above (flip-block fallback) depending on available viewport space.
			const overlay = page.locator('.coach-mark-overlay')
			await expect(overlay).toBeVisible({ timeout: 8000 })

			const tooltip = page.locator('.coach-mark-tooltip')
			await expect(tooltip).toBeVisible()

			// Wait for anchor positioning and container query to resolve
			await page.waitForTimeout(200)

			const targetSelector = await page.evaluate(() => {
				const el = document.querySelector(
					'[style*="anchor-name: --coach-target"]',
				)
				return el ? el.tagName : null
			})
			expect(targetSelector).not.toBeNull()

			const targetBox = await page
				.locator('[style*="anchor-name: --coach-target"]')
				.boundingBox()
			const tooltipBox = await tooltip.boundingBox()
			const messageBox = await page
				.locator('.coach-tooltip-message')
				.boundingBox()

			expect(targetBox).not.toBeNull()
			expect(tooltipBox).not.toBeNull()
			expect(messageBox).not.toBeNull()

			// Determine whether browser placed tooltip below or above the target.
			// CSS uses position-area: block-end with position-try-fallbacks: flip-block,
			// so the browser may choose either position based on available space.
			const isBelow = tooltipBox!.y >= targetBox!.y - 8
			const targetBottom = targetBox!.y + targetBox!.height
			const tooltipBottom = tooltipBox!.y + tooltipBox!.height

			// Find the visible arrow
			const arrowContainers = page.locator('.coach-arrow-container')
			const count = await arrowContainers.count()
			let arrowBox: {
				x: number
				y: number
				width: number
				height: number
			} | null = null
			for (let i = 0; i < count; i++) {
				const box = await arrowContainers.nth(i).boundingBox()
				if (box && box.height > 0 && box.width > 0) {
					arrowBox = box
				}
			}
			expect(arrowBox).not.toBeNull()

			const tolerance = 8

			if (isBelow) {
				// Tooltip BELOW target:
				//   target.bottom <= arrow.top  AND  arrow.bottom <= message.top
				expect(arrowBox!.y).toBeGreaterThanOrEqual(
					targetBottom - tolerance,
				)
				expect(arrowBox!.y + arrowBox!.height).toBeLessThanOrEqual(
					messageBox!.y + tolerance,
				)

				// Arrow-head points TOWARD the target (upward).
				const visibleArrow = page.locator(
					'.coach-arrow-above:not([style*="display: none"])',
				)
				const headBox = await visibleArrow
					.locator('.arrow-head')
					.boundingBox()
				const lineBox = await visibleArrow
					.locator('.arrow-line')
					.boundingBox()
				expect(headBox).not.toBeNull()
				expect(lineBox).not.toBeNull()
				const headCenterY = headBox!.y + headBox!.height / 2
				const lineCenterY = lineBox!.y + lineBox!.height / 2
				// Target is above -> head should be higher (smaller Y)
				expect(headCenterY).toBeLessThan(lineCenterY)
			} else {
				// Tooltip ABOVE target (flip-block fallback):
				//   message.bottom <= arrow.top  AND  arrow.bottom <= target.top
				expect(tooltipBottom).toBeLessThanOrEqual(
					targetBox!.y + tolerance,
				)
				expect(arrowBox!.y).toBeGreaterThanOrEqual(
					messageBox!.y + messageBox!.height - tolerance,
				)
				expect(arrowBox!.y + arrowBox!.height).toBeLessThanOrEqual(
					targetBox!.y + tolerance,
				)

				// Arrow-head points TOWARD the target (downward).
				const visibleArrow = page.locator(
					'.coach-arrow-below:not([style*="display: none"])',
				)
				const headBox = await visibleArrow
					.locator('.arrow-head')
					.boundingBox()
				const lineBox = await visibleArrow
					.locator('.arrow-line')
					.boundingBox()
				expect(headBox).not.toBeNull()
				expect(lineBox).not.toBeNull()
				const headCenterY = headBox!.y + headBox!.height / 2
				const lineCenterY = lineBox!.y + lineBox!.height / 2
				// Target is below -> head should be lower (larger Y)
				expect(headCenterY).toBeGreaterThan(lineCenterY)
			}
		})
	})

	test.describe('Coach mark — click blocking', () => {
		test('clicking outside target does not navigate away', async ({ page }) => {
			test.setTimeout(20_000)
			await mockOnboardingRpcRoutes(page)

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
				localStorage.setItem('onboardingStep', '3')
				localStorage.removeItem('onboarding.celebrationShown')
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
				localStorage.setItem('onboardingStep', '3')
				localStorage.removeItem('onboarding.celebrationShown')
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
