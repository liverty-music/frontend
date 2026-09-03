import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { CoachMark } from './coach-mark'

const meta = {
	title: 'Components/CoachMark',
	component: CoachMark,
	tags: ['test', 'autodocs'],
	argTypes: {
		message: { control: 'text', description: 'Coaching tip copy.' },
		active: {
			control: 'boolean',
			description: 'Activates the spotlight and anchors it to the target.',
		},
		targetSelector: {
			control: 'text',
			description: 'CSS selector of the element the spotlight highlights.',
		},
	},
	args: {
		message: 'カードをタップして、チケットや会場をチェック',
		active: true,
		targetSelector: '#coach-target',
	},
} satisfies Meta<typeof CoachMark>

export default meta
type Story = StoryObj<typeof meta>

// A fixed on-screen target the coach mark can resolve and highlight.
const template = `
	<button id="coach-target" type="button"
		style="position: fixed; inset-block-start: 80px; inset-inline-start: 80px;">
		ライブカード
	</button>
	<coach-mark
		target-selector.bind="targetSelector"
		message.bind="message"
		active.bind="active">
	</coach-mark>
`

// Active: the spotlight overlay and its tooltip render once the target resolves.
export const Active = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [CoachMark] }),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('カードをタップして、チケットや会場をチェック'),
		).toBeInTheDocument()
		await expect(canvas.getByRole('tooltip')).toBeInTheDocument()
	},
} satisfies Story

// Inactive: no overlay is rendered.
export const Inactive = {
	render: (args) =>
		defineAureliaStory({ template, props: args, register: [CoachMark] }),
	args: { active: false },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('[role="tooltip"]')).toBeNull()
	},
} satisfies Story
