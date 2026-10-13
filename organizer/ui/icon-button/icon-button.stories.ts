import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { consoleStoryParameters } from '../story-support'
import { IconButton } from './icon-button'

const meta = {
	title: 'Console/IconButton',
	component: IconButton,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		icon: { control: 'text' },
		label: { control: 'text' },
		disabled: { control: 'boolean' },
	},
	args: { icon: 'more-vert', label: 'メニュー', disabled: false },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default = {
	render: (args) =>
		defineAureliaStory({
			template: `<div style="padding:16px; background:var(--md-color-surface)"><icon-button icon.bind="icon" label.bind="label" disabled.bind="disabled"></icon-button></div>`,
			props: args,
		}),
	play: async ({ canvasElement }) => {
		const button = within(canvasElement).getByRole('button', {
			name: 'メニュー',
		})
		const box = button.getBoundingClientRect()
		await expect(box.width).toBe(48)
		await expect(box.height).toBe(48)
	},
} satisfies Story

export const Disabled = {
	args: { disabled: true },
	render: Default.render,
} satisfies Story
