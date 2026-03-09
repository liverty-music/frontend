import { expectFillsViewport } from './assertions'
import { expect, test } from './fixtures'

test.describe('Loading sequence layout', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.goto('/onboarding/loading')
		await page.waitForSelector('.loading-layout')
	})

	test('loading-layout fills full viewport with no bottom nav (L1)', async ({
		layoutPage: page,
	}) => {
		await expectFillsViewport(page, page.locator('.loading-layout'), 2)

		// Verify no bottom nav is visible
		await expect(page.locator('bottom-nav-bar')).not.toBeVisible()
	})

	test('pulsing-orb centered horizontally within 2px (L2)', async ({
		layoutPage: page,
	}) => {
		const viewportSize = page.viewportSize()!
		const orb = page.locator('.pulsing-orb')

		const orbBox = await orb.boundingBox()
		expect(orbBox).toBeTruthy()

		const orbCenter = orbBox!.x + orbBox!.width / 2
		const viewportCenter = viewportSize.width / 2

		expect(Math.abs(orbCenter - viewportCenter)).toBeLessThanOrEqual(2)
	})
})
