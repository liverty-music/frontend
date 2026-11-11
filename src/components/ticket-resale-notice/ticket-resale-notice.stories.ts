import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { TicketResaleNotice } from './ticket-resale-notice'

const meta = {
	title: 'Components/TicketResaleNotice',
	component: TicketResaleNotice,
} satisfies Meta<typeof TicketResaleNotice>

export default meta
type Story = StoryObj<typeof meta>

/** The 特定興行入場券 notice, ruled on its leading edge. */
export const Default = {
	render: () =>
		defineAureliaStory({
			template:
				'<div style="inline-size: 360px"><ticket-resale-notice></ticket-resale-notice></div>',
			register: [TicketResaleNotice],
		}),
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getByText(/特定興行入場券/),
		).toBeVisible()
	},
} satisfies Story
