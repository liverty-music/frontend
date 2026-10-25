import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
	// The row spans the Discovery column; switch the viewport to see it on
	// other phones. It lays itself out from its own width (container query).
	globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof OnboardingProgress>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: '<onboarding-progress value.bind="value"></onboarding-progress>',
		props: args,
		register: [OnboardingProgress],
	})

function meter(canvasElement: HTMLElement) {
	return within(canvasElement).getByRole('progressbar', {
		name: 'タイムテーブル完成まで',
	})
}

/** No follow yet: an empty band under its label. */
export const Empty = {
	render,
	args: { value: 0 },
	play: async ({ canvasElement }) => {
		await expect(meter(canvasElement)).toHaveAttribute('aria-valuenow', '0')
	},
} satisfies Story

/** Three follows without a found concert: 60 percent. */
export const Partial = {
	tags: ['reduced-motion'],
	render,
	args: { value: 0.6 },
	play: async ({ canvasElement }) => {
		const bar = meter(canvasElement)
		await expect(bar).toHaveAttribute('aria-valuenow', '60')
		await expect(within(canvasElement).getByText('60%')).toBeVisible()
		const fill = canvasElement.querySelector('.onboarding-progress-fill')
		if (!fill) throw new Error('no fill')
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await expect(getComputedStyle(fill).animationName).toBe(
			reduced ? 'none' : 'progress-sheen',
		)
	},
} satisfies Story

/** Every follow moves the band; a button here stands in for a follow. */
export const Filling = {
	render: () =>
		defineAureliaStory({
			template: `
				<onboarding-progress value.bind="value"></onboarding-progress>
				<button type="button" class="[ button ] [ pressable ]" click.trigger="follow()">Follow one more</button>
			`,
			props: {
				value: 0,
				follow(this: { value: number }) {
					this.value = Math.min(1, this.value + 0.2)
				},
			},
			register: [OnboardingProgress],
		}),
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole('button', { name: 'Follow one more' }),
		)
		await waitFor(() =>
			expect(meter(canvasElement)).toHaveAttribute('aria-valuenow', '20'),
		)
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
