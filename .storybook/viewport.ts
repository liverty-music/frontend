/**
 * Runs `check` with the browser window at `width` px, then puts the window
 * back: the size stays with the browser tab for the stories that run after.
 *
 * Only while Vitest runs the story; in the Storybook UI the window is left
 * as it is and `check` runs at whatever width it has. `vitest/browser` is
 * imported only inside the test branch, as in `screenshot.ts`.
 */
export async function atWidth(
	width: number,
	check: () => Promise<void>,
): Promise<void> {
	if (import.meta.env.MODE !== 'test') {
		await check()
		return
	}
	const { page } = await import('vitest/browser')
	const { innerWidth, innerHeight } = window
	try {
		await page.viewport(width, innerHeight)
		await check()
	} finally {
		await page.viewport(innerWidth, innerHeight)
	}
}
