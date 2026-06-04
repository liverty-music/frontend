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

		// ListByFollower is the authenticated path; ListWithProximity is the guest
		// path (ConcertStore.listByFollowerGuest). Both return the same groups.
		if (url.includes('ListByFollower') || url.includes('ListWithProximity')) {
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
									performers: [
										{
											id: { value: 'artist-1' },
											name: { value: 'YOASOBI' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: 's-1' },
										title: { value: 'Zepp Live' },
									},
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
								{
									id: { value: 'c-2' },
									performers: [
										{
											id: { value: 'artist-2' },
											name: { value: 'Vaundy' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: 's-2' },
										title: { value: 'Zepp Live' },
									},
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
					{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, hype: 'watch' },
					{ artist: { id: 'artist-2', name: 'Vaundy', mbid: '' }, hype: 'watch' },
				]),
			)
		})

		await page.goto('/dashboard')
		await page.waitForLoadState('networkidle')

		// Open the filter sheet
		await page.click('button[aria-label="絞り込む"]')

		// Sheet should be open with artist list
		const sheet = page.locator('artist-filter-bar bottom-sheet')
		await expect(sheet).toBeVisible()

		// Both artists should be present as chips in the sheet (scoped to the
		// sheet — the artist name also appears on the concert-highway cards).
		await expect(
			sheet.locator('label.artist-chip', { hasText: 'YOASOBI' }),
		).toBeVisible()
		await expect(
			sheet.locator('label.artist-chip', { hasText: 'Vaundy' }),
		).toBeVisible()
	})

	test('selecting an artist and confirming activates the filter button', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, hype: 'watch' },
					{ artist: { id: 'artist-2', name: 'Vaundy', mbid: '' }, hype: 'watch' },
				]),
			)
		})

		await page.goto('/dashboard')
		await page.waitForLoadState('networkidle')

		await page.click('button[aria-label="絞り込む"]')
		const yoasobiChip = page.locator('label.artist-chip', {
			hasText: 'YOASOBI',
		})
		await expect(yoasobiChip).toBeVisible()

		// Click the YOASOBI chip (input is visually-hidden; click the label instead)
		await yoasobiChip.click()

		// Confirm
		await page.click('button.btn-confirm')

		// Filter button should show active state; no chips in the header
		const filterBtn = page.locator('button[aria-label="絞り込む"]')
		await expect(filterBtn).toHaveAttribute('data-active', 'true')
		await expect(page.locator('.chip-name')).toHaveCount(0)
	})

	test('round-trips the artist filter through the URL query param', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', 'completed')
			localStorage.setItem('onboarding.celebrationShown', '1')
			localStorage.setItem('guest.home', 'JP-13')
			localStorage.setItem(
				'guest.followedArtists',
				JSON.stringify([
					{ artist: { id: 'artist-1', name: 'YOASOBI', mbid: '' }, hype: 'watch' },
					{ artist: { id: 'artist-2', name: 'Vaundy', mbid: '' }, hype: 'watch' },
				]),
			)
		})

		// Deep link: the artist filter is parsed from the URL on load.
		await page.goto('/dashboard?artists=artist-1')
		await page.waitForLoadState('networkidle')

		const filterBtn = page.locator('button[aria-label="絞り込む"]')
		await expect(filterBtn).toHaveAttribute('data-active', 'true')

		// Open the sheet; the deep-linked artist is pre-selected.
		await filterBtn.click()
		const yoasobiChip = page.locator('label.artist-chip', { hasText: 'YOASOBI' })
		await expect(yoasobiChip.locator('input')).toBeChecked()

		// Add the second artist and confirm — the URL reflects both, written once.
		await page.locator('label.artist-chip', { hasText: 'Vaundy' }).click()
		await page.click('button.btn-confirm')

		await expect(page).toHaveURL(/\/dashboard\?artists=artist-1,artist-2$/)
	})
})
