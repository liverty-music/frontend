import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { page } from 'vitest/browser'
import { canvasOf, consoleStoryParameters } from '../story-support'
import { ExtendedFab } from './extended-fab'

const meta = {
	title: 'Console/ExtendedFab',
	component: ExtendedFab,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		icon: { control: 'text' },
		href: { control: 'text' },
	},
	args: { icon: 'add', href: '#new' },
} satisfies Meta<typeof ExtendedFab>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<main style="--nav-bar-clearance: 0px; min-block-size:100vh; background:var(--md-color-surface); color:var(--md-color-on-surface)">
				<extended-fab icon.bind="icon" href.bind="href">公演をつくる</extended-fab>
			</main>
		`,
		props: args,
	})

/**
 * A link at the bottom trailing corner of the window, 56 px high. In the
 * console it also clears the navigation bar of a compact window
 * (`--nav-bar-clearance`, 0 here as beside the rail).
 */
export const Default = {
	render,
	play: async ({ canvasElement }) => {
		await page.viewport(1280, 800)
		const link = canvasOf(canvasElement)
			.getByRole('link', { name: '公演をつくる' })
			.element()
		await expect(link).toHaveAttribute('href', '#new')
		const box = link.getBoundingClientRect()
		await expect(box.height).toBe(56)
		await expect(Math.round(box.right)).toBe(window.innerWidth - 16)
		await expect(Math.round(box.bottom)).toBe(window.innerHeight - 16)
	},
} satisfies Story

/** Without an address it is a button the page handles. */
export const AsAButton = {
	args: { href: '' },
	render,
	play: async ({ canvasElement }) => {
		await expect(
			canvasOf(canvasElement)
				.getByRole('button', { name: '公演をつくる' })
				.element(),
		).toBeVisible()
	},
} satisfies Story
