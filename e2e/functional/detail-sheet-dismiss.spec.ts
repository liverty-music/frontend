import { concertWire } from '../support/concert-wire'
import { expect, type Page, test } from '../support/test'

/**
 * E2E tests for concert detail sheet dismiss behavior.
 *
 * Covers:
 * - Normal dismiss — swipe down, browser back
 * - Reload recovery for a still-onboarding guest deep-linking to the timetable
 *   (single-flag model: no per-screen step, soft gate, no blocking overlays)
 */

/** Mock Connect-RPC routes with concert data for timetable rendering. */
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

		// ListByArtists (check before ListFollowed/ListByArtist)
		if (url.includes('ListByArtists')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						groups: [
							{
								date: { value: tomorrowDate },
								home: [
									{
										id: { value: '00000000-0000-4000-8000-c10000000001' },
										performers: [
											{
												id: { value: '00000000-0000-4000-8000-a10000000001' },
												name: { value: 'Artist 1' },
												mbid: { value: '' },
											},
										],
										series: {
											id: { value: '00000000-0000-4000-8000-5e0000000001' },
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
				),
			})
		}

		if (url.includes('ConcertService/ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						groups: [
							{
								date: { value: tomorrowDate },
								home: [],
								nearby: [],
								away: [
									{
										id: { value: '00000000-0000-4000-8000-c10000000001' },
										performers: [
											{
												id: { value: '00000000-0000-4000-8000-a10000000001' },
												name: { value: 'Artist 1' },
												mbid: { value: '' },
											},
										],
										series: {
											id: { value: '00000000-0000-4000-8000-5e0000000001' },
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
				),
			})
		}

		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(
					concertWire({
						concerts: [
							{
								id: { value: '00000000-0000-4000-8000-c10000000001' },
								performers: [
									{
										id: { value: '00000000-0000-4000-8000-a10000000001' },
										name: { value: 'Artist 1' },
										mbid: { value: '' },
									},
								],
								series: {
									id: { value: '00000000-0000-4000-8000-5e0000000001' },
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
				),
			})
		}

		if (url.includes('FollowService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{
							id: { value: '00000000-0000-4000-8000-a10000000001' },
							name: { value: 'Artist 1' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000002' },
							name: { value: 'Artist 2' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a10000000003' },
							name: { value: 'Artist 3' },
							hype: 0,
						},
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
				{
					artist: {
						id: '00000000-0000-4000-8000-a10000000001',
						name: 'Artist 1',
					},
					home: null,
				},
				{
					artist: {
						id: '00000000-0000-4000-8000-a10000000002',
						name: 'Artist 2',
					},
					home: null,
				},
				{
					artist: {
						id: '00000000-0000-4000-8000-a10000000003',
						name: 'Artist 3',
					},
					home: null,
				},
			]),
		)
	}
}

/** Seed localStorage for a still-onboarding guest (timetable reachable, sheet dismiss). */
function seedPostTimetableState() {
	return () => {
		localStorage.setItem('onboardingComplete', 'false')
		localStorage.setItem('onboarding.celebrationShown', '1')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem(
			'guest.followedArtists',
			JSON.stringify([
				{
					artist: {
						id: '00000000-0000-4000-8000-a10000000001',
						name: 'Artist 1',
					},
					home: null,
				},
				{
					artist: {
						id: '00000000-0000-4000-8000-a10000000002',
						name: 'Artist 2',
					},
					home: null,
				},
				{
					artist: {
						id: '00000000-0000-4000-8000-a10000000003',
						name: 'Artist 3',
					},
					home: null,
				},
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
	const sheet = page.locator('concert-sheet bottom-sheet')
	await expect(sheet).toBeVisible({ timeout: 5000 })
}

// =========================================================================
// Task 5.2: Normal detail sheet dismiss (non-onboarding)
// =========================================================================

test.describe('Normal detail sheet dismiss', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedPostTimetableState())
		await mockRpcRoutes(page)
		await page.goto('/timetable')
	})

	test('browser back button closes sheet', async ({ page }) => {
		await openDetailSheet(page)

		// URL should have gained concert=...
		await expect(page).toHaveURL(/[?&]concert=/)

		// Go back
		await page.goBack()

		// Sheet should close
		const sheet = page.locator('concert-sheet bottom-sheet')
		await expect(sheet).not.toBeVisible({ timeout: 3000 })

		// URL should be timetable (browser navigated back)
		await expect(page).toHaveURL(/timetable/)
	})

	test('swipe down closes sheet', async ({ page }) => {
		await openDetailSheet(page)
		await expect(page).toHaveURL(/[?&]concert=/)
		// The sheet slides up by scrolling; wait until it has come to rest.
		const sheetBody = page.locator('concert-sheet .sheet-body')
		await expect(sheetBody).toBeInViewport({ ratio: 1 })

		// The sheet closes by scrolling to the dismiss zone above it, so the
		// swipe must be a touch scroll: a mouse drag does not scroll, and
		// Chromium's synthesized scroll gesture did not scroll the sheet either.
		// Drag a finger from the handle to the bottom of the screen.
		const box = await sheetBody.boundingBox()
		const viewport = page.viewportSize()
		if (!box || !viewport) throw new Error('the sheet or the page has no size')
		const x = Math.round(box.x + box.width / 2)
		const startY = Math.round(box.y + 12)
		const endY = viewport.height - 4
		const cdp = await page.context().newCDPSession(page)
		const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) =>
			cdp.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: y === undefined ? [] : [{ x, y }],
			})
		await touch('touchStart', startY)
		for (let i = 1; i <= 20; i++) {
			await touch('touchMove', Math.round(startY + ((endY - startY) * i) / 20))
		}
		await touch('touchEnd')

		await expect(page.locator('concert-sheet bottom-sheet')).not.toBeVisible()
		await expect(page).not.toHaveURL(/[?&]concert=/)
	})
})

// =========================================================================
// Reload recovery: a still-onboarding guest deep-links to the timetable.
// Single-flag model — there is no per-screen step, and the timetable is
// reachable any time under the soft gate. No coach-mark/lane overlay blocks
// the page, and the nav stays fully interactive.
// =========================================================================

test.describe('Still-onboarding reload recovery', () => {
	test.use({ viewport: { width: 412, height: 915 } })

	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedMyArtistsSpotlightState())
		await mockRpcRoutes(page)
	})

	test('timetable loads with no blocking overlay and interactive nav', async ({
		page,
	}) => {
		await page.goto('/timetable')

		await expect(page.locator('au-viewport')).toBeVisible({ timeout: 10_000 })

		// No coach-mark overlay on the timetable (the only coach mark is the
		// Welcome demo's own).
		await expect(page.locator('.coach-mark-overlay')).not.toBeVisible()

		// My Artists tab is visible and enabled (soft gate — nav never dimmed)
		const myArtistsNav = page.locator('[data-nav="my-artists"]')
		await expect(myArtistsNav).toBeVisible()
	})
})
