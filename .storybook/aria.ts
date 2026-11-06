/**
 * Compares `element`'s accessibility tree with `template` (Vitest's aria
 * snapshot format; nodes not listed are not checked).
 *
 * Like `expectScreenshot`, the matcher exists only while Vitest runs the story,
 * so the Storybook UI skips this step, and `vitest` is imported only here.
 */
export async function expectAriaTree(
	element: Element,
	template: string,
): Promise<void> {
	if (import.meta.env.MODE !== 'test') return
	const { expect } = await import('vitest')
	await expect.element(element).toMatchAriaInlineSnapshot(template)
}
