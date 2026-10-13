import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, spyOn, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { canvasOf, consoleStoryParameters, deepQuery } from '../story-support'
import { CopyButton } from './copy-button'

const meta = {
	title: 'Console/CopyButton',
	component: CopyButton,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		label: { control: 'text', description: 'What is copied: 受付1.' },
		value: { control: 'text' },
	},
	args: {
		label: 'ファンページ',
		value: 'https://liverty-music.app/events/e-1103',
	},
} satisfies Meta<typeof CopyButton>

export default meta
type Story = StoryObj<typeof meta>

/** Copies its value, shows a check mark and reports コピーしました. */
export const Copy = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="padding:16px; background:var(--md-color-surface); color:var(--md-color-on-surface)">
					<copy-button label.bind="label" value.bind="value"></copy-button>
					<console-snackbar></console-snackbar>
				</div>
			`,
			props: args,
		}),
	play: async ({ canvasElement, args }) => {
		const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
		const canvas = canvasOf(canvasElement)
		await userEvent.click(
			canvas.getByRole('button', { name: 'ファンページをコピー' }),
		)
		await expect(write).toHaveBeenCalledWith(args.value)
		await waitFor(() =>
			expect(
				deepQuery(canvasElement, 'icon-button').getAttribute('data-copied'),
			).toBe('true'),
		)
		await waitFor(() =>
			expect(
				deepQuery(canvasElement, 'snack-bar [role="status"]'),
			).toHaveTextContent('コピーしました'),
		)
		// Fully shown before the page is checked: mid fade, its colors blend.
		await waitFor(() =>
			expect(
				getComputedStyle(deepQuery(canvasElement, '.snack-item')).opacity,
			).toBe('1'),
		)
		write.mockRestore()
	},
} satisfies Story
