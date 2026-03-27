import { expect, test } from '@playwright/test'

test.describe('Settings Push Notification Toggle', () => {
	test.use({ storageState: '.auth/storageState.json' })

	test('push notification toggle exists on settings page', async ({ page }) => {
		await page.goto('/settings')
		await page.waitForTimeout(3000)

		const pushText = page.locator('text=Push Notifications')
		await expect(pushText).toBeVisible()

		const toggle = page.locator('button[role="switch"]')
		await expect(toggle).toBeVisible()
	})
})
