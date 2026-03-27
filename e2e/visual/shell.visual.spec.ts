import { expect, test } from './fixtures'

test.describe('Shell layout visual regression', () => {
	test('discover page shell layout', async ({ discoverLayoutPage: page }) => {
		await page.goto('/discovery')
		await page.waitForSelector('.discovery-layout')

		await expect(page).toHaveScreenshot('shell-discover.png')
	})

	test('welcome page fullscreen layout (no bottom nav)', async ({
		layoutPage: page,
	}) => {
		await page.goto('/welcome')
		await page.locator('au-viewport > *').first().waitFor({ timeout: 10_000 })

		await expect(page).toHaveScreenshot('shell-welcome-fullscreen.png')
	})
})
