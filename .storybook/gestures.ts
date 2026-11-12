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

/**
 * Drags a finger vertically across `selector` through each offset of `path`
 * (px, positive is down) and lifts it; `[160]` is a swipe down.
 */
export async function swipeVertically(
	selector: string,
	path: number[],
): Promise<boolean> {
	if (import.meta.env.MODE !== 'test') return false
	const { commands } = await import('vitest/browser')
	await commands.swipeVertically(selector, path)
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

/** Moves the real pointer over `element`, so `:hover` matches. */
export async function hoverPointer(element: Element): Promise<boolean> {
	if (import.meta.env.MODE !== 'test') return false
	const { userEvent } = await import('vitest/browser')
	await userEvent.hover(element)
	return true
}

/** A real mouse click on `element`: it takes focus without keyboard focus-visible. */
export async function clickPointer(element: Element): Promise<boolean> {
	if (import.meta.env.MODE !== 'test') return false
	const { userEvent } = await import('vitest/browser')
	await userEvent.click(element)
	return true
}

/** Moves the real pointer to the page's top-left corner, over no control. */
export async function parkPointerAway(): Promise<boolean> {
	if (import.meta.env.MODE !== 'test') return false
	const { commands } = await import('vitest/browser')
	await commands.parkPointer()
	return true
}
