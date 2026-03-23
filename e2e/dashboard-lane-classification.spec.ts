import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for dashboard lane classification after home selection.
 *
 * Verifies fix-dashboard-lane-classification:
 * - Bug 1: loadData() is called after home selection (blur removed, data reloaded)
 * - Bug 2: Returning user with home already set doesn't see home selector
 *
 * Note: During onboarding (guest phase), groupConcertsByDate() places ALL
 * concerts into the "away" lane. Server-side HOME/NEARBY/AWAY classification
 * only applies after sign-up when ListByFollower RPC is used. These tests
 * verify the reload mechanism and UI state, not lane placement logic.
 *
 * The authenticated path for Bug 2 (UserService/Get → user.home) cannot be
 * tested without real OIDC auth. Unit tests in dashboard.spec.ts cover that
 * path. These E2E tests verify the equivalent guest-side scenarios.
 */

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

/** Concert response payload for ConcertService/List mock. */
function concertListPayload() {
	return {
		concerts: [
			{
				id: { value: 'c-1' },
				artistId: { value: 'artist-1' },
				title: { value: 'Zepp DiverCity Live' },
				localDate: {
					value: {
						year: tomorrow.getFullYear(),
						month: tomorrow.getMonth() + 1,
						day: tomorrow.getDate(),
					},
				},
				venue: {
					name: { value: 'Zepp DiverCity' },
					adminArea: { value: 'JP-13' },
				},
				sourceUrl: { value: 'https://example.com' },
			},
		],
	}
}

/** Mock RPC routes with concert data for onboarding (ConcertService/ListWithProximity). */
async function mockOnboardingRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('SearchNewConcerts')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({}),
			})
		}

		// ListWithProximity (check before List to avoid substring match)
		if (url.includes('ListWithProximity')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					groups: [
						{
							date: concertListPayload().concerts[0].localDate,
							home: concertListPayload().concerts,
							nearby: [],
							away: [],
						},
					],
				}),
			})
		}

		if (url.includes('ConcertService/List')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(concertListPayload()),
			})
		}

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{ id: { value: 'artist-1' }, name: { value: 'YOASOBI' }, hype: 0 },
						{ id: { value: 'artist-2' }, name: { value: 'Vaundy' }, hype: 0 },
						{ id: { value: 'artist-3' }, name: { value: 'Ado' }, hype: 0 },
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

/** Mock Last.fm API. */
async function mockLastFmApi(page: Page): Promise<void> {
	await page.route('**/ws.audioscrobbler.com/**', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

test.describe('Dashboard lane classification after home selection', () => {
	test.beforeEach(async ({ page }) => {
		await mockOnboardingRpcRoutes(page)
		await mockLastFmApi(page)
	})

	test('3.2: onboarding home selection removes blur and reloads data', async ({
		page,
	}) => {
		test.setTimeout(30_000)

		// Seed: step 3, followed artists, NO guest.home -> needsRegion = true
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.removeItem('guest.home')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: { id: 'artist-1', name: 'YOASOBI', mbid: 'mbid-1' },
						home: null,
					},
					{
						artist: { id: 'artist-2', name: 'Vaundy', mbid: 'mbid-2' },
						home: null,
					},
					{
						artist: { id: 'artist-3', name: 'Ado', mbid: 'mbid-3' },
						home: null,
					},
				]),
			)
		})

		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard to render with blur applied (needsRegion = true)
		const blurElement = page.locator('[data-blurred="true"]')
		await expect(blurElement).toBeVisible({ timeout: 10_000 })

		// Home selector dialog should open automatically
		const regionDialog = page.locator('user-home-selector bottom-sheet')
		await expect(regionDialog).toBeVisible({ timeout: 5000 })

		// Select a home region — expect loadData() to fire (ListWithProximity RPC)
		const reloadPromise = page.waitForResponse(
			(resp) => resp.url().includes('ListWithProximity'),
			{ timeout: 10_000 },
		)
		const regionOption = regionDialog.locator('button').first()
		await regionOption.click()

		// After selection: blur should be removed (needsRegion = false)
		await expect(page.locator('[data-blurred="true"]')).toHaveCount(0, {
			timeout: 5000,
		})

		// loadData() should have fired (ConcertService/List response received)
		await reloadPromise

		// Concert cards should eventually appear
		const liveCard = page.locator('[data-live-card]')
		await expect(liveCard.first()).toBeVisible({ timeout: 10_000 })
	})

	test('3.3: returning user with stored home does not show home selector', async ({
		page,
	}) => {
		// Seed: step 3, guest.home already set, celebration already shown.
		// This simulates returning to dashboard after having already selected home.
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'dashboard')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{
						artist: { id: 'artist-1', name: 'YOASOBI', mbid: 'mbid-1' },
						home: 'JP-13',
					},
					{
						artist: { id: 'artist-2', name: 'Vaundy', mbid: 'mbid-2' },
						home: 'JP-13',
					},
					{
						artist: { id: 'artist-3', name: 'Ado', mbid: 'mbid-3' },
						home: 'JP-13',
					},
				]),
			)
		})

		await page.goto('http://localhost:9000/dashboard')

		// Wait for dashboard content to render
		await page.waitForSelector('.concert-scroll', {
			timeout: 10_000,
		})

		// Blur should NOT be applied (needsRegion = false because guest.home is set)
		const blurElement = page.locator('[data-blurred="true"]')
		await expect(blurElement).toHaveCount(0)

		// Home selector dialog should NOT be open
		const regionDialog = page.locator('user-home-selector bottom-sheet:popover-open')
		await expect(regionDialog).toHaveCount(0)
	})
})
