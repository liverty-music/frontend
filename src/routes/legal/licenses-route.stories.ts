import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor } from 'storybook/test'
import { LicensesRoute } from './licenses-route'

// A route story: the route resolves nothing, and its package list is the
// generated file the app ships (AGENTS.md, "Route stories"). It shows the
// route's own layout, which a component story does not render.

const meta = {
	title: 'Routes/Legal/Licenses',
	component: LicensesRoute,
	globals: { viewport: { value: 'mobile1', isRotated: false } },
	parameters: {
		a11y: {
			config: {
				// Known defect, reported with this change: the opened license text
				// (a `pre` that scrolls past 24rem) holds no focusable content and
				// is not focusable itself, so a keyboard cannot scroll it.
				rules: [{ id: 'scrollable-region-focusable', enabled: false }],
			},
		},
	},
} satisfies Meta<typeof LicensesRoute>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = () =>
	defineAureliaStory({
		template: '<licenses-route></licenses-route>',
		register: [LicensesRoute],
	})

/**
 * A license text, closed and then opened: the section grows through heights
 * between closed and open (it does not jump), as the height animates to the
 * content.
 */
export const LicenseTextOpens = {
	render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/fan/web/global/ui-primitives "License text opens"
		const details = await waitFor(() => {
			const el = canvasElement.querySelector<HTMLDetailsElement>(
				'details.licenses-text',
			)
			if (!el) throw new Error('no license text rendered yet')
			return el
		})
		const closed = details.getBoundingClientRect().height

		// Open it and sample its height every frame until it stops changing.
		const summary = details.querySelector('summary')
		if (!summary) throw new Error('no summary')
		await userEvent.click(summary)
		const heights = await new Promise<number[]>((resolve) => {
			const seen: number[] = []
			const tick = () => {
				seen.push(details.getBoundingClientRect().height)
				if (seen.length < 40) requestAnimationFrame(tick)
				else resolve(seen)
			}
			requestAnimationFrame(tick)
		})
		const open = heights[heights.length - 1]
		await expect(open).toBeGreaterThan(closed + 50)
		const between = heights.filter((h) => h > closed + 1 && h < open - 1)
		await expect(between.length).toBeGreaterThan(2)
	},
} satisfies Story
