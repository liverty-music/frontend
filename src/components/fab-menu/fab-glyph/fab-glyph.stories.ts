import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { FabGlyph } from './fab-glyph'

const meta = {
	title: 'Components/FabGlyph',
	component: FabGlyph,
	argTypes: {
		open: {
			control: 'boolean',
			description: 'The arc is open: the close cross shows, not the equalizer.',
		},
	},
	args: { open: false },
} satisfies Meta<typeof FabGlyph>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 24px; block-size: 24px; color: var(--color-on-surface)">
			<fab-glyph open.bind="open"></fab-glyph>
		</div>`,
		props: args,
		register: [FabGlyph],
	})

/** The arc is closed: the equalizer. */
export const Closed = {
	render,
	args: { open: false },
	play: async ({ canvasElement }) => {
		const glyph = canvasElement.querySelector('.fab-glyph')
		await expect(glyph).toHaveAttribute('data-open', 'false')
		await expect(canvasElement.querySelectorAll('.fab-bar')).toHaveLength(3)
	},
} satisfies Story

/** The arc is open: the close cross. */
export const Open = {
	render,
	args: { open: true },
	play: async ({ canvasElement }) => {
		const glyph = canvasElement.querySelector('.fab-glyph')
		await expect(glyph).toHaveAttribute('data-open', 'true')
		await expect(canvasElement.querySelector('.fab-close')).not.toBeNull()
	},
} satisfies Story
