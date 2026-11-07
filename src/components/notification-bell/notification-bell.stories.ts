import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
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
	},
} satisfies Story

export const TwoUnread = {
	args: { unreadCount: 2 },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByTestId('notification-bell-badge'),
		).toHaveTextContent('2')
	},
} satisfies Story
