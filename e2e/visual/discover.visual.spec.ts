import { expect, test } from './fixtures'

test.describe('Discover page visual regression', () => {
	test('bubble mode layout', async ({ discoverLayoutPage: page }) => {
		await page.goto('/discovery')
		await page.waitForSelector('.discovery-layout')
		await page.waitForSelector('dna-orb-canvas canvas')

		await expect(page).toHaveScreenshot('discover-bubble-mode.png')
	})

	test('search mode layout', async ({ discoverLayoutPage: page }) => {
		await page.goto('/discovery')
		await page.waitForSelector('.discovery-layout')

		const searchInput = page.locator('input[placeholder]')
		await searchInput.fill('test')
		await expect(page.locator('[data-search-mode="true"]')).toBeVisible()

		await expect(page).toHaveScreenshot('discover-search-mode.png')
	})
})
