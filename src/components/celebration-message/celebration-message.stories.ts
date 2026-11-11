import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { CelebrationMessage } from './celebration-message'

const meta = {
	title: 'Components/CelebrationMessage',
	component: CelebrationMessage,
	argTypes: {
		message: { control: 'text', description: 'The headline.' },
		subMessage: { control: 'text', description: 'An optional second line.' },
		hint: { control: 'text', description: 'An optional hint below.' },
	},
	args: { message: 'ようこそ！\nLiverty Music へ', subMessage: '', hint: '' },
} satisfies Meta<typeof CelebrationMessage>

export default meta
type Story = StoryObj<typeof meta>

// The overlay draws the lines on its dark scrim; this frame stands in for it.
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="display: grid; place-items: center; row-gap: 16px; padding-block: 32px; background: black">
			<celebration-message
				message.bind="message"
				sub-message.bind="subMessage"
				hint.bind="hint"
			></celebration-message>
		</div>`,
		props: args,
		register: [CelebrationMessage],
	})

/** The headline alone. */
export const HeadlineOnly = {
	tags: ['reduced-motion'],
	render,
	play: async ({ canvasElement }) => {
		const lines = canvasElement.querySelectorAll('p')
		await expect(lines).toHaveLength(1)
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await expect(getComputedStyle(lines[0]).animationName).toBe(
			reduced ? 'none' : 'headline-enter',
		)
	},
} satisfies Story

/** The headline, a second line and a hint. */
export const AllLines = {
	render,
	args: {
		subMessage: 'タイムテーブルが完成しました',
		hint: 'タップして閉じる',
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByText('タイムテーブルが完成しました'),
		).toBeInTheDocument()
		await expect(canvas.getByText('タップして閉じる')).toBeInTheDocument()
	},
} satisfies Story
