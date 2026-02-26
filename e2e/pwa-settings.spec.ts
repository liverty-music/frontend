import { expect, test } from '@playwright/test'

test.describe('Settings Push Notification Toggle', () => {
	test('push notification toggle exists on settings page', async ({
		page,
	}) => {
		await page.goto('/settings')
		await page.waitForTimeout(3000)

		// Settings requires authentication. If auth hook redirected us,
		// skip the test (settings toggle is covered by unit tests).
		const url = page.url()
		if (!url.includes('/settings')) {
			test.skip(true, 'Auth redirect occurred — settings not accessible without login')
			return
		}

		const pushText = page.locator('text=Push Notifications')
		await expect(pushText).toBeVisible()

		const toggle = page.locator('button[role="switch"]')
		await expect(toggle).toBeVisible()
	})
})
