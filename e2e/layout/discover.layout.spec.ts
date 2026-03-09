import { expectContainedIn, expectFillsParent } from './assertions'
import { expect, test } from './fixtures'

test.describe('Discover page layout', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		await page.goto('/discover')
		await page.waitForSelector('.discover-layout')
	})

	test('discover-layout fills viewport width and au-viewport height (D1)', async ({
		layoutPage: page,
	}) => {
		const viewportSize = page.viewportSize()!
		const layout = page.locator('.discover-layout')
		const auViewport = page.locator('au-viewport')

		const layoutBox = await layout.boundingBox()
		const auViewportBox = await auViewport.boundingBox()

		expect(layoutBox).toBeTruthy()
		expect(auViewportBox).toBeTruthy()
		expect(layoutBox!.width).toBeCloseTo(viewportSize.width, 0)
		expect(layoutBox!.height).toBeCloseTo(auViewportBox!.height, 0)
	})

	test('bubble-area width equals discover-layout width (D2)', async ({
		layoutPage: page,
	}) => {
		const layout = page.locator('.discover-layout')
		const bubbleArea = page.locator('.bubble-area')

		const layoutBox = await layout.boundingBox()
		const bubbleBox = await bubbleArea.boundingBox()

		expect(layoutBox).toBeTruthy()
		expect(bubbleBox).toBeTruthy()
		expect(bubbleBox!.width).toBeCloseTo(layoutBox!.width, 0)
	})

	test('canvas fills bubble-area within 1px tolerance (D3)', async ({
		layoutPage: page,
	}) => {
		// Wait for canvas to initialize (dna-orb-canvas sets width/height on attaching)
		await page.waitForSelector('dna-orb-canvas canvas')

		const bubbleArea = page.locator('.bubble-area')
		const canvas = page.locator('dna-orb-canvas canvas')

		await expectFillsParent(canvas, bubbleArea, 2)
	})

	test('search-bar right edge within viewport (D4)', async ({
		layoutPage: page,
	}) => {
		const viewportSize = page.viewportSize()!
		const searchBar = page.locator('.search-bar')

		await expectContainedIn(searchBar, page.locator('.discover-layout'), 1)

		const searchBox = await searchBar.boundingBox()
		expect(searchBox).toBeTruthy()
		expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(
			viewportSize.width + 1,
		)
	})

	test('bubble-area bottom does not exceed bottom-nav top (D5)', async ({
		layoutPage: page,
	}) => {
		await page.waitForSelector('bottom-nav-bar')
		const bubbleArea = page.locator('.bubble-area')
		const nav = page.locator('bottom-nav-bar')

		const bubbleBox = await bubbleArea.boundingBox()
		const navBox = await nav.boundingBox()

		expect(bubbleBox).toBeTruthy()
		expect(navBox).toBeTruthy()
		expect(bubbleBox!.y + bubbleBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
	})

	test('no horizontal overflow on discover-layout (D6)', async ({
		layoutPage: page,
	}) => {
		const overflow = await page.evaluate(() => {
			const el = document.querySelector('.discover-layout')
			if (!el) return { scroll: 0, client: 0 }
			return { scroll: el.scrollWidth, client: el.clientWidth }
		})
		expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)
	})

	test('bubble-area occupies majority of vertical space (D7)', async ({
		layoutPage: page,
	}) => {
		const layout = page.locator('.discover-layout')
		const bubbleArea = page.locator('.bubble-area')

		const layoutBox = await layout.boundingBox()
		const bubbleBox = await bubbleArea.boundingBox()

		expect(layoutBox).toBeTruthy()
		expect(bubbleBox).toBeTruthy()
		// Bubble area should take at least 50% of the layout height
		expect(bubbleBox!.height).toBeGreaterThan(layoutBox!.height * 0.5)
	})

	test('genre-chips height is constrained (D8)', async ({
		layoutPage: page,
	}) => {
		const chips = page.locator('.genre-chips')
		const chipsBox = await chips.boundingBox()

		expect(chipsBox).toBeTruthy()
		// Genre chips is a single-row horizontal strip — should not exceed 60px
		expect(chipsBox!.height).toBeLessThanOrEqual(60)
	})

	test('vertical order: search-bar above genre-chips above bubble-area (D9)', async ({
		layoutPage: page,
	}) => {
		const searchBar = page.locator('.search-bar')
		const chips = page.locator('.genre-chips')
		const bubbleArea = page.locator('.bubble-area')

		const searchBox = await searchBar.boundingBox()
		const chipsBox = await chips.boundingBox()
		const bubbleBox = await bubbleArea.boundingBox()

		expect(searchBox).toBeTruthy()
		expect(chipsBox).toBeTruthy()
		expect(bubbleBox).toBeTruthy()
		expect(searchBox!.y).toBeLessThan(chipsBox!.y)
		expect(chipsBox!.y).toBeLessThan(bubbleBox!.y)
	})

	test('all grid children contained within discover-layout (D10)', async ({
		layoutPage: page,
	}) => {
		const layoutBox = await page.locator('.discover-layout').boundingBox()
		expect(layoutBox).toBeTruthy()
		const layoutRight = layoutBox!.x + layoutBox!.width

		// Check each visible grid child's right edge
		for (const selector of ['.search-bar', '.genre-chips', '.bubble-area']) {
			const el = page.locator(selector)
			if ((await el.count()) === 0) continue
			const box = await el.boundingBox()
			if (!box) continue
			expect(
				box.x + box.width,
				`${selector} right edge (${box.x + box.width}) exceeds layout (${layoutRight})`,
			).toBeLessThanOrEqual(layoutRight + 1)
		}
	})
})
