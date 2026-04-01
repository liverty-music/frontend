import { expect, type Page, test } from '@playwright/test'

/**
 * E2E tests for the artist filter bar bottom sheet.
 *
 * Verifies fix-artist-filter-bar-empty-sheet:
 * - Followed artists are displayed in the filter sheet (previously always empty)
 * - Selecting artists and confirming updates the chip list
 */

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{ id: { value: 'artist-1' }, name: { value: 'YOASOBI' }, hype: 0 },
						{ id: { value: 'artist-2' }, name: { value: 'Vaundy' }, hype: 0 },
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
							date: {
								value: {
									year: tomorrow.getFullYear(),
									month: tomorrow.getMonth() + 1,
									day: tomorrow.getDate(),
								},
							},
							home: [
								{
									id: { value: 'c-1' },
									artistId: { value: 'artist-1' },
									title: { value: 'Zepp Live' },
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
							nearby: [],
							away: [],
						},
					],
				}),
			})
		}

		if (url.includes('ListByUser')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ journeys: [] }),
			})
		}

		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

async function mockLastFmApi(page: Page): Promise<void> {
	await page.route('**/ws.audioscrobbler.com/**', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		})
	})
}

test.describe('Artist filter bar bottom sheet', () => {
	test.beforeEach(async ({ page }) => {
		await mockRpcRoutes(page)
		await mockLastFmApi(page)
	})

	test('displays followed artists in the filter sheet', async ({ page }) => {
		// Seed: post-onboarding guest with home set and followed artists
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, home: null },
					{ artist: { id: 'artist-2', name: 'Vaundy', mbid: '' }, home: null },
				]),
			)
		})

		await page.goto('/dashboard')
		await page.waitForLoadState('networkidle')

		// Open the filter sheet
		await page.click('button[aria-label="アーティストで絞り込む"]')

		// Sheet should be open with artist list
		const sheet = page.locator('artist-filter-bar bottom-sheet')
		await expect(sheet).toBeVisible()

		// Both artists should be visible in the sheet
		await expect(page.getByText('YOASOBI')).toBeVisible()
		await expect(page.getByText('Vaundy')).toBeVisible()
	})

	test('selecting an artist and confirming shows a filter chip', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, home: null },
					{ artist: { id: 'artist-2', name: 'Vaundy', mbid: '' }, home: null },
				]),
			)
		})

		await page.goto('/dashboard')
		await page.waitForLoadState('networkidle')

		await page.click('button[aria-label="アーティストで絞り込む"]')
		await expect(page.getByText('YOASOBI')).toBeVisible()

		// Check YOASOBI
		await page.getByLabel('YOASOBI').check()

		// Confirm
		await page.click('button.btn-confirm')

		// Chip should appear
		await expect(
			page.locator('.chip-name', { hasText: 'YOASOBI' }),
		).toBeVisible()
	})
})
