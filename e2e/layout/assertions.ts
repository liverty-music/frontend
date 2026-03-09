import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Assert that an element fills the full viewport (width and height).
 */
export async function expectFillsViewport(
	page: Page,
	locator: Locator,
	tolerance = 1,
): Promise<void> {
	const viewport = page.viewportSize()
	if (!viewport) throw new Error('Viewport size not set')

	const box = await locator.boundingBox()
	expect(box, `Element not found or not visible: ${locator}`).toBeTruthy()

	expect(box!.width).toBeCloseTo(viewport.width, -Math.log10(tolerance))
	expect(box!.height).toBeCloseTo(viewport.height, -Math.log10(tolerance))
}

/**
 * Assert that a child element is fully contained within a parent element.
 */
export async function expectContainedIn(
	child: Locator,
	parent: Locator,
	tolerance = 1,
): Promise<void> {
	const childBox = await child.boundingBox()
	const parentBox = await parent.boundingBox()
	expect(childBox, 'Child element not found').toBeTruthy()
	expect(parentBox, 'Parent element not found').toBeTruthy()

	expect(childBox!.x).toBeGreaterThanOrEqual(parentBox!.x - tolerance)
	expect(childBox!.y).toBeGreaterThanOrEqual(parentBox!.y - tolerance)
	expect(childBox!.x + childBox!.width).toBeLessThanOrEqual(
		parentBox!.x + parentBox!.width + tolerance,
	)
	expect(childBox!.y + childBox!.height).toBeLessThanOrEqual(
		parentBox!.y + parentBox!.height + tolerance,
	)
}

/**
 * Assert that an element is anchored to a specific edge of the viewport.
 */
export async function expectAnchored(
	page: Page,
	locator: Locator,
	edge: 'top' | 'bottom' | 'left' | 'right',
	tolerance = 1,
): Promise<void> {
	const viewport = page.viewportSize()
	if (!viewport) throw new Error('Viewport size not set')

	const box = await locator.boundingBox()
	expect(box, `Element not found: ${locator}`).toBeTruthy()

	switch (edge) {
		case 'top':
			expect(box!.y).toBeCloseTo(0, -Math.log10(tolerance))
			break
		case 'bottom':
			expect(box!.y + box!.height).toBeCloseTo(
				viewport.height,
				-Math.log10(tolerance),
			)
			break
		case 'left':
			expect(box!.x).toBeCloseTo(0, -Math.log10(tolerance))
			break
		case 'right':
			expect(box!.x + box!.width).toBeCloseTo(
				viewport.width,
				-Math.log10(tolerance),
			)
			break
	}
}

/**
 * Assert that an element fills the same dimensions as another element.
 */
export async function expectFillsParent(
	child: Locator,
	parent: Locator,
	tolerance = 1,
): Promise<void> {
	const childBox = await child.boundingBox()
	const parentBox = await parent.boundingBox()
	expect(childBox, 'Child element not found').toBeTruthy()
	expect(parentBox, 'Parent element not found').toBeTruthy()

	expect(childBox!.width).toBeCloseTo(parentBox!.width, -Math.log10(tolerance))
	expect(childBox!.height).toBeCloseTo(
		parentBox!.height,
		-Math.log10(tolerance),
	)
}
