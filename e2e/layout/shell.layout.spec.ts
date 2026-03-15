import { expectAnchored, expectFillsViewport } from './assertions'
import { expect, test } from './fixtures'

test.describe('Shell layout', () => {
	test('app-shell fills viewport height (S1)', async ({
		discoverLayoutPage: page,
	}) => {
		await page.goto('/discover')
		await page.waitForSelector('.discover-layout')

		const appShell = page.locator('app-shell')
		await expectFillsViewport(page, appShell, 2)
	})

	test('au-viewport + bottom-nav equals app-shell height (S2)', async ({
		discoverLayoutPage: page,
	}) => {
		await page.goto('/discover')
		await page.waitForSelector('.discover-layout')

		const appShell = page.locator('app-shell')
		const viewport = page.locator('au-viewport')
		const nav = page.locator('bottom-nav-bar')

		const appShellBox = await appShell.boundingBox()
		const viewportBox = await viewport.boundingBox()
		const navBox = await nav.boundingBox()

		expect(appShellBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(navBox).toBeTruthy()

		const combined = viewportBox!.height + navBox!.height
		expect(combined).toBeCloseTo(appShellBox!.height, 0)
	})

	test('bottom-nav anchored to viewport bottom (S3)', async ({
		discoverLayoutPage: page,
	}) => {
		await page.goto('/discover')
		await page.waitForSelector('.discover-layout')

		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})

	test('au-viewport fills full height without nav (S4)', async ({
		layoutPage: page,
	}) => {
		// Welcome page is a fullscreen route (no bottom-nav).
		await page.goto('/welcome')
		// Wait for au-viewport to contain rendered content
		await page.locator('au-viewport > *').first().waitFor({ timeout: 10_000 })

		const appShell = page.locator('app-shell')
		const viewport = page.locator('au-viewport')

		const appShellBox = await appShell.boundingBox()
		const viewportBox = await viewport.boundingBox()

		expect(appShellBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(viewportBox!.height).toBeCloseTo(appShellBox!.height, 0)
	})
})
