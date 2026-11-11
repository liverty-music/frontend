import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { OnboardingProgressMeter } from './onboarding-progress-meter'

const meta = {
	title: 'Components/OnboardingProgressMeter',
	component: OnboardingProgressMeter,
	argTypes: {
		percent: {
			control: { type: 'range', min: 0, max: 100, step: 1 },
			description: 'How full the band is, from 0 to 100.',
		},
		rise: {
			control: { type: 'inline-radio' },
			options: [0, 1],
			description:
				'Alternates with every rise of the value; a change flares the spark.',
		},
	},
	args: { percent: 0, rise: 0 },
} satisfies Meta<typeof OnboardingProgressMeter>

export default meta
type Story = StoryObj<typeof meta>

// The band in a 240px row under its label, as the progress row places it.
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 240px">
			<span id="meter-label">Progress</span>
			<onboarding-progress-meter
				percent.bind="percent"
				rise.bind="rise"
				labelled-by="meter-label"
			></onboarding-progress-meter>
		</div>`,
		props: args,
		register: [OnboardingProgressMeter],
	})

/** No follow yet: an empty groove, the spark hidden. */
export const Empty = {
	render,
	args: { percent: 0 },
	play: async ({ canvasElement }) => {
		const bar = within(canvasElement).getByRole('progressbar', {
			name: 'Progress',
		})
		await expect(bar).toHaveAttribute('aria-valuenow', '0')
	},
} satisfies Story

/** Part filled: the light reaches 60 percent, the spark at its edge. */
export const Partial = {
	render,
	args: { percent: 60, rise: 1 },
	play: async ({ canvasElement }) => {
		const bar = within(canvasElement).getByRole('progressbar')
		await expect(bar.style.getPropertyValue('--progress')).toBe('60')
		const spark = canvasElement.querySelector('.onboarding-progress-spark')
		await expect(spark).toHaveAttribute('data-rise', '1')
	},
} satisfies Story
