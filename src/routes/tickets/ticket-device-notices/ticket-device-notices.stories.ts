import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { TicketDeviceNotices } from './ticket-device-notices'

const meta = {
	title: 'Routes/Tickets/TicketDeviceNotices',
	component: TicketDeviceNotices,
	argTypes: {
		offline: { control: 'boolean', description: 'The list is a saved copy.' },
		device: {
			control: 'select',
			options: [
				'checking',
				'ready',
				'other-device',
				'needs-connection',
				'failed',
			],
			description: 'Whether this device can show entry codes.',
		},
		movedHere: {
			control: 'boolean',
			description: 'The codes were just taken over from another device.',
		},
		confirming: {
			control: 'boolean',
			description: 'The fan is asked to confirm the move.',
		},
	},
	args: {
		loaded: true,
		offline: false,
		savedAt: '11/10 21:05',
		device: 'ready',
		movedHere: false,
		canOfferMove: false,
		confirming: false,
		moving: false,
		moveFailed: false,
	},
} satisfies Meta<typeof TicketDeviceNotices>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 360px">
			<ticket-device-notices
				class="[ flow ]"
				loaded.bind="loaded"
				offline.bind="offline"
				saved-at.bind="savedAt"
				device.bind="device"
				moved-here.bind="movedHere"
				can-offer-move.bind="canOfferMove"
				confirming.bind="confirming"
				moving.bind="moving"
				move-failed.bind="moveFailed"
			></ticket-device-notices>
		</div>`,
		props: args,
		register: [TicketDeviceNotices],
	})

/** Offline: the list shown is the copy saved at a time. */
export const Offline = {
	render,
	args: { offline: true, device: 'needs-connection' },
	play: async ({ canvasElement }) => {
		const notices = canvasElement.querySelectorAll('.tickets-notice')
		await expect(notices).toHaveLength(2)
		await expect(notices[0]).toHaveTextContent('11/10 21:05')
		await expect(notices[1]).toHaveAttribute('data-tone', 'warning')
	},
} satisfies Story

/** The codes live on another device: an offer to move them here. */
export const OtherDevice = {
	render,
	args: { device: 'other-device', canOfferMove: true },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getAllByRole('button')).toHaveLength(1)
	},
} satisfies Story

/** The fan asked to move the codes: confirm or cancel, after a failure. */
export const ConfirmingMove = {
	render,
	args: {
		device: 'other-device',
		canOfferMove: true,
		confirming: true,
		moveFailed: true,
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getAllByRole('button')).toHaveLength(2)
		await expect(canvasElement.querySelector('.tickets-error')).not.toBe(null)
	},
} satisfies Story

/** The codes were just taken over from another device. */
export const MovedHere = {
	render,
	args: { movedHere: true },
	play: async ({ canvasElement }) => {
		await expect(
			canvasElement.querySelectorAll('.tickets-notice'),
		).toHaveLength(1)
	},
} satisfies Story
