import { expect, test } from '@playwright/test'

test.describe('Settings page visual regression (authenticated)', () => {
	test('settings page layout', async ({ page }) => {
		await page.goto('/settings')
		await page.waitForSelector('settings-route', { timeout: 10_000 })

		await expect(page).toHaveScreenshot('settings-layout.png')
	})
})
