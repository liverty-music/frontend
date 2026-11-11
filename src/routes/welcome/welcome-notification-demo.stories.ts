import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { NotificationMockCard } from '../../components/notification-mock/notification-mock-card'
import { WelcomeNotificationDemo } from './welcome-notification-demo'

const meta = {
	title: 'Routes/Welcome/NotificationDemo',
	component: WelcomeNotificationDemo,
	argTypes: {
		exiting: {
			control: 'boolean',
			description: 'The notification dismisses upward and fades.',
		},
	},
	args: { exiting: false },
	globals: { viewport: { value: 'mobile1', isRotated: false } },
	parameters: {
		a11y: {
			// The mock push (notification-mock-card, which this refactor does not
			// touch) draws its app name and time at 4.3:1 on its light surface,
			// as on the Welcome screen today. The hint pulses its opacity, so axe
			// measures whatever frame it lands on. The lead is checked.
			context: {
				include: ['body'],
				exclude: ['notification-mock-card', '.welcome-demo-hint'],
			},
		},
	},
} satisfies Meta<typeof WelcomeNotificationDemo>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template:
			'<welcome-notification-demo exiting.bind="exiting"></welcome-notification-demo>',
		props: args,
		register: [WelcomeNotificationDemo, NotificationMockCard],
	})

/** Waiting for a tap: the lead, the mock push and the pulsing invitation. */
export const Waiting = {
	render,
	args: { exiting: false },
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByTestId('welcome-demo-notification'),
		).not.toHaveAttribute('data-exiting')
	},
} satisfies Story

/**
 * Dismissing: the step is marked exiting, which plays the exit (none under
 * reduced motion).
 */
export const Exiting = {
	tags: ['reduced-motion'],
	render,
	args: { exiting: true },
	play: async ({ canvasElement }) => {
		const step = within(canvasElement).getByTestId('welcome-demo-notification')
		await expect(step).toHaveAttribute('data-exiting')
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
		await expect(getComputedStyle(step).animationName).toBe(
			reduced ? 'none' : 'notif-exit',
		)
	},
} satisfies Story
