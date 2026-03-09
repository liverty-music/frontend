import { expect, test } from '@playwright/test'
import { expectAnchored, expectContainedIn } from './assertions'

test.describe('Settings page layout (authenticated)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/settings')
		await page.waitForSelector('settings-page', { timeout: 10_000 })
	})

	test('settings container fills au-viewport height', async ({ page }) => {
		const viewport = page.locator('au-viewport')
		const settings = page.locator('settings-page > div').first()

		const viewportBox = await viewport.boundingBox()
		const settingsBox = await settings.boundingBox()

		expect(viewportBox).toBeTruthy()
		expect(settingsBox).toBeTruthy()
		expect(settingsBox!.height).toBeGreaterThanOrEqual(viewportBox!.height - 1)
	})

	test('settings container has overflow-y auto for scrolling', async ({
		page,
	}) => {
		const container = page.locator('settings-page > div').first()
		await expect(container).toHaveCSS('overflow-y', 'auto')
	})

	test('settings content is contained within viewport width', async ({
		page,
	}) => {
		const viewport = page.locator('au-viewport')
		const settings = page.locator('settings-page > div').first()

		await expectContainedIn(settings, viewport)
	})

	test('bottom-nav is visible and anchored to bottom', async ({ page }) => {
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})
})
