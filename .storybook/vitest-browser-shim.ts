/**
 * Stands in for `vitest/browser` in the Storybook UI. The real module exists
 * only inside a Vitest browser run, and importing it anywhere else throws, which
 * replaced every console story that imports it (through `story-support.ts` or
 * for `userEvent`) with an error before it rendered. With this module the story
 * renders; a step that drives the page through `vitest/browser` reports that it
 * needs Vitest (`npm run test-storybook`) instead of failing at import.
 */
function unavailable(): never {
	throw new Error(
		'This step uses vitest/browser, which runs only under Vitest (npm run test-storybook). The story is rendered; its interaction is not run in the Storybook UI.',
	)
}

const trap: object = new Proxy(unavailable, {
	get: (_target, key) => (key === 'then' ? undefined : trap),
	apply: unavailable,
})

export const page = trap as never
export const userEvent = trap as never
export const commands = trap as never
export const server = trap as never
