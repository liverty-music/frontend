import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { FabGlyph } from '../fab-glyph/fab-glyph'
import { FabToggle } from './fab-toggle'

const meta = {
	title: 'Components/FabToggle',
	component: FabToggle,
} satisfies Meta<typeof FabToggle>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The FAB in the top layer, as `fab-menu` shows it, with the arc's popover it
 * controls (empty here). `open` selects the glyph: equalizer or close cross.
 */
const render =
	(open: boolean): Story['render'] =>
	() =>
		defineAureliaStory({
			template: `
				<fab-toggle open.bind="open"></fab-toggle>
				<dialog id="fab-menu-panel" popover="auto" aria-label="Actions"></dialog>
			`,
			props: { open },
			register: [FabToggle, FabGlyph],
		})

async function shown(root: HTMLElement): Promise<HTMLButtonElement> {
	const button = root.querySelector<HTMLButtonElement>('.fab-toggle')
	if (!button) throw new Error('no FAB')
	button.showPopover()
	return button
}

/** Collapsed: the equalizer glyph, a 56 px round FAB. */
export const Closed = {
	render: render(false),
	play: async ({ canvasElement }) => {
		const button = await shown(canvasElement)
		await expect(button.getAttribute('aria-expanded')).toBe('false')
		await expect(button.getBoundingClientRect().width).toBe(56)
		const close = button.querySelector('.fab-close') as Element
		await expect(getComputedStyle(close).opacity).toBe('0')
	},
} satisfies Story

/** Expanded: the close cross replaces the equalizer. */
export const Open = {
	render: render(true),
	play: async ({ canvasElement }) => {
		const button = await shown(canvasElement)
		await expect(button.getAttribute('aria-expanded')).toBe('true')
		await expect(
			button.querySelector('.fab-glyph')?.getAttribute('data-open'),
		).toBe('true')
	},
} satisfies Story
