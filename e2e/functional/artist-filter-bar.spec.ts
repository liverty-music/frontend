import { expect, type Page, test } from '../support/test'

/**
 * E2E tests for the artist filter bar bottom sheet.
 *
 * Verifies fix-artist-filter-bar-empty-sheet:
 * - Followed artists are displayed in the filter sheet (previously always empty)
 * - Selecting artists and confirming updates the chip list
 */

const tomorrow = new Date()
tomorrow.setDate(tomorrow.getDate() + 1)

// The filter trigger moved from a header button into the FAB action launcher:
// open the FAB, then tap the filter command (which opens the sheet and closes
// the launcher panel).
async function openFilterSheet(page: Page): Promise<void> {
	await page.click('fab-menu .fab-toggle')
	await page.click('fab-menu .fab-item[data-action-id="filter"]')
}

// The active-filter indicator now lives on the launcher's filter item. Reopen
// the FAB to read it, then dismiss the launcher again.
async function expectFilterActive(page: Page): Promise<void> {
	await page.click('fab-menu .fab-toggle')
	await expect(
		page.locator('fab-menu .fab-item[data-action-id="filter"]'),
	).toHaveAttribute('data-active', 'true')
	await page.keyboard.press('Escape')
}

async function mockRpcRoutes(page: Page): Promise<void> {
	await page.route('**/liverty_music.rpc.**', (route) => {
		const url = route.request().url()

		if (url.includes('ListFollowed')) {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					artists: [
						{
							id: { value: '00000000-0000-4000-8000-a00000000001' },
							name: { value: 'YOASOBI' },
							hype: 0,
						},
						{
							id: { value: '00000000-0000-4000-8000-a00000000002' },
							name: { value: 'Vaundy' },
							hype: 0,
						},
					],
				}),
			})
		}

		// ListByFollower is the authenticated path; ListByArtists is the guest
		// path (ConcertStore.listByFollowerGuest). Both return the same groups.
		if (url.includes('ListByFollower') || url.includes('ListByArtists')) {
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
									id: { value: '00000000-0000-4000-8000-c10000000001' },
									performers: [
										{
											id: { value: '00000000-0000-4000-8000-a00000000001' },
											name: { value: 'YOASOBI' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: '00000000-0000-4000-8000-5e0000000001' },
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
									id: { value: '00000000-0000-4000-8000-c10000000002' },
									performers: [
										{
											id: { value: '00000000-0000-4000-8000-a00000000002' },
											name: { value: 'Vaundy' },
											mbid: { value: '' },
										},
									],
									series: {
										id: { value: '00000000-0000-4000-8000-5e0000000002' },
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
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000001',
							name: 'YOASOBI',
							mbid: '',
						},
						hype: 'watch',
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000002',
							name: 'Vaundy',
							mbid: '',
						},
						hype: 'watch',
					},
				]),
			)
		})

		await page.goto('/dashboard')
		await page.waitForLoadState('networkidle')

		// Open the filter sheet (via the FAB launcher)
		await openFilterSheet(page)

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
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000001',
							name: 'YOASOBI',
							mbid: '',
						},
						hype: 'watch',
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000002',
							name: 'Vaundy',
							mbid: '',
						},
						hype: 'watch',
					},
				]),
			)
		})

		await page.goto('/dashboard')
		await page.waitForLoadState('networkidle')

		await openFilterSheet(page)
		const yoasobiChip = page.locator('label.artist-chip', {
			hasText: 'YOASOBI',
		})
		await expect(yoasobiChip).toBeVisible()

		// Click the YOASOBI chip (input is visually-hidden; click the label instead)
		await yoasobiChip.click()

		// Confirm
		await page.click('button.btn-confirm')

		// The launcher's filter item shows active state; no chips in the header
		await expectFilterActive(page)
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
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000001',
							name: 'YOASOBI',
							mbid: '',
						},
						hype: 'watch',
					},
					{
						artist: {
							id: '00000000-0000-4000-8000-a00000000002',
							name: 'Vaundy',
							mbid: '',
						},
						hype: 'watch',
					},
				]),
			)
		})

		// Deep link: the artist filter is parsed from the URL on load.
		await page.goto('/dashboard?artists=00000000-0000-4000-8000-a00000000001')
		await page.waitForLoadState('networkidle')

		await expectFilterActive(page)

		// Open the sheet; the deep-linked artist is pre-selected.
		await openFilterSheet(page)
		const yoasobiChip = page.locator('label.artist-chip', {
			hasText: 'YOASOBI',
		})
		await expect(yoasobiChip.locator('input')).toBeChecked()

		// Add the second artist and confirm — the URL reflects both, written once.
		await page.locator('label.artist-chip', { hasText: 'Vaundy' }).click()
		await page.click('button.btn-confirm')

		await expect(page).toHaveURL(
			/\/dashboard\?artists=00000000-0000-4000-8000-a00000000001,00000000-0000-4000-8000-a00000000002$/,
		)
	})
})
