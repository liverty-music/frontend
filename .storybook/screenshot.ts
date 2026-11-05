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
 */
export async function capturePixels(element: Element): Promise<string | null> {
	if (import.meta.env.MODE !== 'test') return null
	const { page } = await import('vitest/browser')
	return page.screenshot({ element, save: false })
}
