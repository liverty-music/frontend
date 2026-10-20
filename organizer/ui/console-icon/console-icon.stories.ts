import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { consoleStoryParameters, deepQuery } from '../story-support'
import { CONSOLE_ICON_NAMES, ConsoleIcon } from './console-icon'

const meta = {
	title: 'Console/ConsoleIcon',
	component: ConsoleIcon,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		name: { control: 'select', options: CONSOLE_ICON_NAMES },
	},
	args: { name: 'help' },
} satisfies Meta<typeof ConsoleIcon>

export default meta
type Story = StoryObj<typeof meta>

/**
 * 使い方 in the top bar: the outlined help icon, 24 px in the text color,
 * decorative (the link that holds it carries the name).
 */
export const Help = {
	render: (args) =>
		defineAureliaStory({
			template: `<div style="padding:16px; color:var(--md-color-on-surface-variant); background:var(--md-color-surface)"><console-icon name.bind="name"></console-icon></div>`,
			props: args,
		}),
	play: async ({ canvasElement }) => {
		const svg = deepQuery<SVGSVGElement>(canvasElement, 'svg')
		await expect(svg).toHaveAttribute('aria-hidden', 'true')
		const box = svg.getBoundingClientRect()
		await expect([box.width, box.height]).toEqual([24, 24])
		// The outlined glyph: a ring around the question mark, not a filled disc.
		const path = deepQuery<SVGPathElement>(canvasElement, 'path')
		await expect(path.getAttribute('d')).toMatch(/^M11 18h2v-2h-2v2z/)
	},
} satisfies Story

/** Every icon of the console, to compare their weight side by side. */
export const All = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-wrap:wrap; gap:16px; padding:16px; color:var(--md-color-on-surface); background:var(--md-color-surface)">
					<console-icon repeat.for="name of names" name.bind="name" title.bind="name"></console-icon>
				</div>
			`,
			props: { names: CONSOLE_ICON_NAMES },
		}),
	play: async ({ canvasElement }) => {
		const icons = canvasElement.querySelectorAll('console-icon')
		await expect(icons).toHaveLength(CONSOLE_ICON_NAMES.length)
		for (const icon of icons) {
			const d = deepQuery<SVGPathElement>(icon, 'path').getAttribute('d')
			await expect(d, icon.getAttribute('title') ?? '').toBeTruthy()
		}
	},
} satisfies Story
