/**
 * Real pointer and touch gestures for stories (`pointer-commands.ts`). The
 * commands exist only while Vitest runs the story, so in the Storybook UI each
 * helper does nothing and returns false; a story checks the result before
 * asserting what the gesture should have done.
 */

/** Swipes a finger sideways across `selector` by `dx` px and lifts it. */
export async function swipeSideways(
	selector: string,
	dx: number,
): Promise<boolean> {
	if (import.meta.env.MODE !== 'test') return false
	const { commands } = await import('vitest/browser')
	await commands.swipeSideways(selector, dx)
	return true
}

/** Presses the pointer down on `selector` and keeps it down. */
export async function pressAndHold(selector: string): Promise<boolean> {
	if (import.meta.env.MODE !== 'test') return false
	const { commands } = await import('vitest/browser')
	await commands.pressAndHold(selector)
	return true
}

/** Lifts the pointer that `pressAndHold` pressed. */
export async function releasePointer(): Promise<void> {
	if (import.meta.env.MODE !== 'test') return
	const { commands } = await import('vitest/browser')
	await commands.releasePointer()
}
