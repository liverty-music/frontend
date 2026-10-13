import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { canvasOf, consoleStoryParameters } from '../story-support'
import { LinearProgress } from './linear-progress'

const meta = {
	title: 'Console/LinearProgress',
	component: LinearProgress,
	tags: ['test', 'autodocs', 'reduced-motion'],
	parameters: consoleStoryParameters,
	argTypes: { label: { control: 'text' } },
	args: { label: '読み込み中' },
} satisfies Meta<typeof LinearProgress>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A 4 px indeterminate bar named 読み込み中. It moves, and stands still under
 * reduced motion. Not compared as a screenshot: the bar is animated.
 */
export const Indeterminate = {
	render: (args) =>
		defineAureliaStory({
			template: `<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)"><linear-progress label.bind="label"></linear-progress></div>`,
			props: args,
		}),
	play: async ({ canvasElement }) => {
		const bar = canvasOf(canvasElement)
			.getByRole('progressbar', { name: '読み込み中' })
			.element()
		await expect(bar.getBoundingClientRect().height).toBe(4)
		await expect(bar).not.toHaveAttribute('aria-valuenow')
		const indicator = bar.firstElementChild as HTMLElement
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await expect(getComputedStyle(indicator).animationName).toBe(
			reduced ? 'none' : 'linear-progress-slide',
		)
	},
} satisfies Story
