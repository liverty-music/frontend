import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import { JOURNEY_STATUS_CONFIG_MAP } from '../../entities/ticket-journey'
import { JourneyStatusRow } from './journey-status-row'
import type { JourneyStatus } from './live-event'

const statuses = (['applied', 'unpaid', 'paid', 'lost'] as const).map(
	(status) => JOURNEY_STATUS_CONFIG_MAP[status],
)

/** Records the status each press reports. */
const pressed = fn()

const meta = {
	title: 'Components/JourneyStatusRow',
	component: JourneyStatusRow,
	argTypes: {
		status: {
			control: 'select',
			options: [undefined, 'tracking', 'applied', 'unpaid', 'paid', 'lost'],
			description: 'The current status; its node is pressed.',
		},
		disabled: { control: 'boolean', description: 'While a save runs.' },
	},
	args: { status: undefined, disabled: false },
} satisfies Meta<typeof JourneyStatusRow>

export default meta
type Story = StoryObj<typeof meta>

/** On the detail sheet's surface, as wide as the sheet on a phone. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 360px; background: var(--md-sys-color-surface-container)">
			<div
				as-element="journey-status-row"
				class="[ journey-row ] [ cluster ]"
				role="group"
				aria-label="Ticket"
				statuses.bind="statuses"
				status.bind="status"
				disabled.bind="disabled"
				status-pressed.trigger="pressed($event.detail)"
			></div>
		</div>`,
		props: { ...args, statuses, pressed },
		register: [JourneyStatusRow],
	})

const node = (root: HTMLElement, status: JourneyStatus) =>
	root.querySelector(`[data-journey-status="${status}"]`) as HTMLButtonElement

/** No status yet: every node outlined, none pressed. */
export const NoStatus = {
	render,
	play: async ({ canvasElement }) => {
		const pressedNodes = canvasElement.querySelectorAll('[aria-pressed="true"]')
		await expect(pressedNodes).toHaveLength(0)
	},
} satisfies Story

/** Paid: that node filled in its status hue; a press reports the status. */
export const Paid = {
	render,
	args: { status: 'paid' },
	play: async ({ canvasElement }) => {
		await expect(node(canvasElement, 'paid')).toHaveAttribute(
			'aria-pressed',
			'true',
		)
		await userEvent.click(
			within(canvasElement).getAllByTestId('journey-btn')[0],
		)
		await expect(pressed).toHaveBeenCalledWith('applied')
	},
} satisfies Story

/** While a save runs, every node is disabled. */
export const Saving = {
	render,
	args: { status: 'applied', disabled: true },
	play: async ({ canvasElement }) => {
		await expect(node(canvasElement, 'lost')).toBeDisabled()
	},
} satisfies Story
