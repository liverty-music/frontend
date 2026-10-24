import { expect } from 'vitest'

/**
 * Compares `element` with its committed baseline (`__screenshots__`).
 *
 * `toMatchScreenshot` is a @vitest/browser matcher: it works only while Vitest
 * runs the story (`npm run test-storybook`, the `storybook-test` CI job), where
 * Vite's mode is `test`. In the Storybook UI no test is running, and calling it
 * throws, which replaced the whole story with an error. There the story still
 * renders and runs its other assertions; only this step is skipped.
 */
export async function expectScreenshot(
	element: Element,
	name: string,
): Promise<void> {
	if (import.meta.env.MODE !== 'test') return
	await expect.element(element).toMatchScreenshot(name)
}
