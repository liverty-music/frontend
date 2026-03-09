import { expectAnchored, expectFillsParent } from './assertions'
import { expect, test } from './fixtures'

test.describe('Dashboard layout', () => {
	test.beforeEach(async ({ layoutPage: page }) => {
		// Dashboard requires onboardingStep >= 3 (DASHBOARD) and a stored home
		// to render without auth. Set guest.home so needsRegion is false
		// (prevents overflow-hidden blur overlay that clips content).
		await page.addInitScript(() => {
			localStorage.setItem('onboardingStep', '3')
			localStorage.setItem('guest.home', 'JP-13')
		})
		await page.goto('/dashboard')
		// Wait for the promise.bind to resolve and render content
		await page.waitForSelector('live-highway, [class*="justify-center"]', {
			timeout: 5000,
		})
	})

	test('dashboard custom element fills au-viewport (DB1)', async ({
		layoutPage: page,
	}) => {
		const auViewport = page.locator('au-viewport')
		const dashboard = page.locator('au-viewport > *').first()

		await expectFillsParent(dashboard, auViewport, 2)
	})

	test('content area has non-zero height (DB2)', async ({
		layoutPage: page,
	}) => {
		// The promise.bind container — flex-1 min-h-0 child of the root flex column.
		// This is the div that collapsed to 0px when grid-template-rows: 1fr was missing.
		const contentHeight = await page.evaluate(() => {
			const root = document.querySelector('au-viewport > * > .flex.flex-col')
			if (!root) return { root: 0, content: 0 }
			const children = root.children
			// Last child of the flex column is the promise content area
			const content = children[children.length - 1] as HTMLElement
			return {
				root: root.getBoundingClientRect().height,
				content: content?.getBoundingClientRect().height ?? 0,
			}
		})

		expect(
			contentHeight.root,
			'root flex column should have height',
		).toBeGreaterThan(100)
		expect(
			contentHeight.content,
			'content area should not collapse to zero',
		).toBeGreaterThan(50)
	})

	test('visible content not clipped by zero-height ancestor (DB3)', async ({
		layoutPage: page,
	}) => {
		// Find any visible text element inside the dashboard content
		// (either live-highway groups or empty state text)
		const visibleText = page
			.locator(
				'au-viewport h1, au-viewport p, au-viewport [class*="font-display"]',
			)
			.first()
		await expect(visibleText).toBeVisible()

		const box = await visibleText.boundingBox()
		expect(box, 'text element should have a bounding box').toBeTruthy()
		expect(box!.height).toBeGreaterThan(0)
	})

	test('bottom-nav anchored to viewport bottom (DB4)', async ({
		layoutPage: page,
	}) => {
		await expectAnchored(page, page.locator('bottom-nav-bar'), 'bottom', 2)
	})

	test('au-viewport + bottom-nav equals my-app height (DB5)', async ({
		layoutPage: page,
	}) => {
		const myAppBox = await page.locator('my-app').boundingBox()
		const viewportBox = await page.locator('au-viewport').boundingBox()
		const navBox = await page.locator('bottom-nav-bar').boundingBox()

		expect(myAppBox).toBeTruthy()
		expect(viewportBox).toBeTruthy()
		expect(navBox).toBeTruthy()

		const combined = viewportBox!.height + navBox!.height
		expect(combined).toBeCloseTo(myAppBox!.height, 0)
	})
})
