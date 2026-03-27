import { expect, test } from './fixtures'

function seedWithArtists() {
	return () => {
		localStorage.setItem('onboardingStep', 'my-artists')
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
	}
}

function seedEmpty() {
	return () => {
		localStorage.setItem('onboardingStep', 'my-artists')
		localStorage.setItem('guest.home', 'JP-13')
		localStorage.setItem('guest.followedArtists', JSON.stringify([]))
	}
}

test.describe('My Artists visual regression', () => {
	test('list view with 3 artists', async ({ layoutPage: page }) => {
		await page.addInitScript(seedWithArtists())
		await page.goto('/my-artists')
		await page.waitForSelector('my-artists-route .artists-table', {
			timeout: 5000,
		})

		await expect(page).toHaveScreenshot('my-artists-list.png')
	})

	test('empty state', async ({ layoutPage: page }) => {
		await page.addInitScript(seedEmpty())
		await page.goto('/my-artists')
		await page.waitForSelector('my-artists-route state-placeholder', {
			timeout: 5000,
		})

		await expect(page).toHaveScreenshot('my-artists-empty.png')
	})
})
