import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { OnboardingProgress } from './onboarding-progress'

const meta = {
	title: 'Components/OnboardingProgress',
	component: OnboardingProgress,
	tags: ['test', 'autodocs'],
	argTypes: {
		value: {
			control: { type: 'range', min: 0, max: 1, step: 0.01 },
			description:
				'Readiness of the onboarding timetable from 0 to 1; at 1 the row becomes the link to the Dashboard.',
		},
	},
	args: { value: 0 },
} satisfies Meta<typeof OnboardingProgress>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="inline-size: 390px">
				<onboarding-progress value.bind="value"></onboarding-progress>
			</div>
		`,
		props: args,
		register: [OnboardingProgress],
	})

/** No follow yet: an empty bar under its label. */
export const Empty = {
	render,
	args: { value: 0 },
	play: async ({ canvasElement }) => {
		const bar = within(canvasElement).getByRole('progressbar', {
			name: 'タイムテーブル完成まで',
		})
		await expect(bar).toHaveAttribute('value', '0')
	},
} satisfies Story

/** Three follows without a found concert: 60 percent. */
export const Partial = {
	render,
	args: { value: 0.6 },
	play: async ({ canvasElement }) => {
		const bar = within(canvasElement).getByRole('progressbar', {
			name: 'タイムテーブル完成まで',
		})
		await expect(bar).toHaveAttribute('value', '60')
	},
} satisfies Story

/** Ready: the row is the one action that opens the Dashboard. */
export const Ready = {
	render,
	args: { value: 1 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const link = canvas.getByRole('link', {
			name: 'タイムテーブルができました →',
		})
		await expect(link).toHaveAttribute('href', '/dashboard')
		await expect(canvas.queryByRole('progressbar')).toBeNull()
	},
} satisfies Story
