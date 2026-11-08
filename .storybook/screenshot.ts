/**
 * Compares `element` with its committed baseline (`__screenshots__`).
 *
 * `toMatchScreenshot` is a @vitest/browser matcher: it works only while Vitest
 * runs the story (`npm run test-storybook`, the `storybook-test` CI job), where
 * Vite's mode is `test`. In the Storybook UI no test is running, so this step is
 * skipped and the story still renders and runs its other assertions.
 *
 * `vitest` is imported only inside the test branch: loading the module outside
 * its runner throws at import time (its `expect` setup reads the missing worker
 * state), which replaced every story that imported this helper with an error in
 * the Storybook UI.
 */
export async function expectScreenshot(
	element: Element,
	name: string,
): Promise<void> {
	if (import.meta.env.MODE !== 'test') return
	const { expect } = await import('vitest')
	await expect.element(element).toMatchScreenshot(name)
}

/**
 * The pixels the page shows where `element` is, as a base64 PNG, including
 * anything drawn over it (a view transition's snapshots, the top layer). Only
 * while Vitest runs the story; `null` in the Storybook UI.
 *
 * `blockEndInset` leaves out that many CSS px at the bottom. Screenshots are
 * scaled down, so the last pixel row of a capture can blend in the first CSS
 * px of whatever sits right below `element`.
 */
export async function capturePixels(
	element: Element,
	{ blockEndInset = 0 }: { blockEndInset?: number } = {},
): Promise<string | null> {
	if (import.meta.env.MODE !== 'test') return null
	const { page } = await import('vitest/browser')
	if (blockEndInset === 0) return page.screenshot({ element, save: false })
	// A transparent box over the area to capture: a screenshot of it shows
	// what the page draws there.
	const rect = element.getBoundingClientRect()
	const area = document.createElement('div')
	Object.assign(area.style, {
		position: 'fixed',
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		width: `${rect.width}px`,
		height: `${rect.height - blockEndInset}px`,
		pointerEvents: 'none',
	})
	document.body.append(area)
	try {
		return await page.screenshot({ element: area, save: false })
	} finally {
		area.remove()
	}
}
