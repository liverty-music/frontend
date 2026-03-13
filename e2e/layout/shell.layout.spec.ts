import { expectAnchored, expectFillsViewport } from './assertions'
import { expect, test } from './fixtures'

test.describe('Shell layout', () => {
	test('my-app fills viewport height (S1)', async ({
		discoverLayoutPage: page,
	}) => {
		await page.goto('/discover')
		await page.waitForSelector('.discover-layout')

		const myApp = page.locator('my-app')
		await expectFillsViewport(page, myApp, 2)
	})

	test('au-viewport + bottom-nav equals my-app height (S2)', async ({
		discoverLayoutPage: page,
	}) => {
		await page.goto('/discover')
		await page.waitForSelector('.discover-layout')

		const myApp = page.locator('my-app')
		const viewport = page.locator('au-viewport')
		const nav = page.locator('bottom-nav-bar')

		const myAppBox = await myApp.boundingBox()
		const viewportBox = await viewport.boundingBox()
		const navBox = await nav.boundingBox()

		expect(myAppBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(navBox).toBeTruthy()

		const combined = viewportBox!.height + navBox!.height
		expect(combined).toBeCloseTo(myAppBox!.height, 0)
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

		const myApp = page.locator('my-app')
		const viewport = page.locator('au-viewport')

		const myAppBox = await myApp.boundingBox()
		const viewportBox = await viewport.boundingBox()

		expect(myAppBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(viewportBox!.height).toBeCloseTo(myAppBox!.height, 0)
	})
})
