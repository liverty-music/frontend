import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor, within } from 'storybook/test'
import { hoverPointer } from '../../../.storybook/gestures'
import { NotificationBell } from './notification-bell'

const meta = {
	title: 'Components/NotificationBell',
	component: NotificationBell,
	argTypes: {
		unreadCount: {
			control: 'number',
			description: 'Unread notifications; no badge at 0.',
		},
	},
	render: (args) =>
		defineAureliaStory({
			template:
				'<notification-bell unread-count.bind="unreadCount"></notification-bell>',
			props: args,
			register: [NotificationBell],
		}),
} satisfies Meta<typeof NotificationBell>

export default meta
type Story = StoryObj<typeof meta>

export const NoUnread = {
	args: { unreadCount: 0 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.queryByTestId('notification-bell-badge')).toBeNull()
		// Nothing unread: the outline bell.
		await expect(
			canvasElement.querySelector('[data-testid="notification-bell-icon"] svg'),
		).toHaveAttribute('fill', 'none')
	},
} satisfies Story

export const TwelveUnread = {
	args: { unreadCount: 12 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByTestId('notification-bell-badge'),
		).toHaveTextContent('12')
	},
} satisfies Story

export const TwoUnread = {
	args: { unreadCount: 2 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByTestId('notification-bell-badge'),
		).toHaveTextContent('2')
		// Something unread: the filled bell.
		await expect(
			canvasElement.querySelector('[data-testid="notification-bell-icon"] svg'),
		).toHaveAttribute('fill', 'currentColor')
	},
} satisfies Story

/** Pointer over the bell: the shared state layer tints it. */
export const Hovered = {
	args: { unreadCount: 0 },
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector('button') as HTMLButtonElement
		const rest = getComputedStyle(button).backgroundColor
		if (!(await hoverPointer(button))) return
		await waitFor(() =>
			expect(getComputedStyle(button).backgroundColor).not.toBe(rest),
		)
	},
} satisfies Story
