import { expectContainedIn, expectFillsParent } from './assertions'
import { expect, test } from './fixtures'

test.describe('Discover page layout', () => {
	test.beforeEach(async ({ discoverLayoutPage: page }) => {
		await page.goto('/discovery')
		await page.waitForSelector('.discovery-layout')
	})

	test('discover-layout fills viewport width and remaining height below page-header (D1)', async ({
		discoverLayoutPage: page,
	}) => {
		const viewportSize = page.viewportSize()!
		const layout = page.locator('.discovery-layout')
		const auViewport = page.locator('au-viewport')

		const layoutBox = await layout.boundingBox()
		const auViewportBox = await auViewport.boundingBox()

		expect(layoutBox).toBeTruthy()
		expect(auViewportBox).toBeTruthy()
		expect(layoutBox!.width).toBeCloseTo(viewportSize.width, 0)
		// discovery-layout occupies the "content" grid row, below page-header
		const layoutBottom = layoutBox!.y + layoutBox!.height
		const auViewportBottom = auViewportBox!.y + auViewportBox!.height
		expect(layoutBottom).toBeCloseTo(auViewportBottom, 0)
	})

	test('bubble-area width equals discover-layout width (D2)', async ({
		discoverLayoutPage: page,
	}) => {
		const layout = page.locator('.discovery-layout')
		const bubbleArea = page.locator('.bubble-area')

		const layoutBox = await layout.boundingBox()
		const bubbleBox = await bubbleArea.boundingBox()

		expect(layoutBox).toBeTruthy()
		expect(bubbleBox).toBeTruthy()
		expect(bubbleBox!.width).toBeCloseTo(layoutBox!.width, 0)
	})

	test('canvas fills bubble-area within 1px tolerance (D3)', async ({
		discoverLayoutPage: page,
	}) => {
		// Wait for canvas to initialize (dna-orb-canvas sets width/height on attaching)
		await page.waitForSelector('dna-orb-canvas canvas')

		const bubbleArea = page.locator('.bubble-area')
		const canvas = page.locator('dna-orb-canvas canvas')

		await expectFillsParent(canvas, bubbleArea, 2)
	})

	test('search-bar right edge within viewport (D4)', async ({
		discoverLayoutPage: page,
	}) => {
		const viewportSize = page.viewportSize()!
		const searchBar = page.locator('.search-bar')

		await expectContainedIn(searchBar, page.locator('.discovery-layout'), 1)

		const searchBox = await searchBar.boundingBox()
		expect(searchBox).toBeTruthy()
		expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(
			viewportSize.width + 1,
		)
	})

	test('bubble-area bottom does not exceed bottom-nav top (D5)', async ({
		discoverLayoutPage: page,
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
		discoverLayoutPage: page,
	}) => {
		const overflow = await page.evaluate(() => {
			const el = document.querySelector('.discovery-layout')
			if (!el) return { scroll: 0, client: 0 }
			return { scroll: el.scrollWidth, client: el.clientWidth }
		})
		expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)
	})

	test('bubble-area occupies majority of vertical space (D7)', async ({
		discoverLayoutPage: page,
	}) => {
		const layout = page.locator('.discovery-layout')
		const bubbleArea = page.locator('.bubble-area')

		const layoutBox = await layout.boundingBox()
		const bubbleBox = await bubbleArea.boundingBox()

		expect(layoutBox).toBeTruthy()
		expect(bubbleBox).toBeTruthy()
		// Bubble area should take at least 50% of the layout height
		expect(bubbleBox!.height).toBeGreaterThan(layoutBox!.height * 0.5)
	})

	test('genre-chips height is constrained (D8)', async ({
		discoverLayoutPage: page,
	}) => {
		const chips = page.locator('.genre-chips')
		const chipsBox = await chips.boundingBox()

		expect(chipsBox).toBeTruthy()
		// Genre chips is a single-row horizontal strip — should not exceed 60px
		expect(chipsBox!.height).toBeLessThanOrEqual(60)
	})

	test('vertical order: search-bar above genre-chips above bubble-area (D9)', async ({
		discoverLayoutPage: page,
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

	test('search-icon has explicit size and flex-shrink: 0 (D10a)', async ({
		discoverLayoutPage: page,
	}) => {
		const icon = page.locator('.search-icon')
		const styles = await icon.evaluate((el) => {
			const cs = getComputedStyle(el)
			return {
				flexShrink: cs.flexShrink,
				width: el.getBoundingClientRect().width,
				height: el.getBoundingClientRect().height,
			}
		})
		expect(styles.flexShrink).toBe('0')
		expect(styles.width).toBeGreaterThan(0)
		expect(styles.height).toBeGreaterThan(0)
		// Should not exceed 30px (compact icon)
		expect(styles.width).toBeLessThanOrEqual(30)
		expect(styles.height).toBeLessThanOrEqual(30)
	})

	test('discover-layout uses 3-row grid (D10b)', async ({
		discoverLayoutPage: page,
	}) => {
		const rows = await page.locator('.discovery-layout').evaluate((el) => {
			return getComputedStyle(el).gridTemplateRows
		})
		// Should have exactly 3 row tracks (auto auto 1fr resolves to specific px values)
		const trackCount = rows.split(/\s+/).length
		expect(trackCount).toBe(3)
	})

	test('all grid children contained within discover-layout (D10)', async ({
		discoverLayoutPage: page,
	}) => {
		const layoutBox = await page.locator('.discovery-layout').boundingBox()
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
