import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { Toast } from './toast'

const meta = {
	title: 'Components/Toast',
	component: Toast,
	tags: ['test', 'autodocs'],
	argTypes: {
		open: {
			control: 'boolean',
			description:
				'Shows/hides the popover via `showPopover()`/`hidePopover()`.',
		},
		ariaLabel: {
			control: 'text',
			description: 'Accessible name applied to the popover dialog.',
		},
	},
	args: { open: false, ariaLabel: '通知' },
} satisfies Meta<typeof Toast>

export default meta
type Story = StoryObj<typeof meta>

const template = `
	<toast open.bind="open" aria-label.bind="ariaLabel">
		<p>新しいライブが1件見つかりました</p>
	</toast>
`

// Open state: the popover is shown and its projected content is present.
export const Open = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [Toast] }),
	args: { open: true },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const dialog = canvasElement.querySelector('dialog')
		await expect(dialog).toBeTruthy()
		await expect(
			canvas.getByText('新しいライブが1件見つかりました'),
		).toBeInTheDocument()
	},
} satisfies Story

// Closed state: the dialog is present in the DOM but not shown as a popover.
export const Closed = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [Toast] }),
	args: { open: false },
	play: async ({ canvasElement }) => {
		const dialog = canvasElement.querySelector('dialog')
		await expect(dialog).toBeTruthy()
		await expect(dialog?.matches(':popover-open')).toBe(false)
	},
} satisfies Story
