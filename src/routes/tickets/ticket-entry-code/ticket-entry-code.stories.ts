import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { TicketEntryCode } from './ticket-entry-code'

const meta = {
	title: 'Routes/Tickets/TicketEntryCode',
	component: TicketEntryCode,
	argTypes: {
		eventTitle: { control: 'text', description: "The event's title." },
		image: {
			control: 'text',
			description: 'The QR image, or empty while the code is being made.',
		},
	},
	args: { eventTitle: 'Summer Live 2026', numbers: [1, 2, 3], image: '' },
} satisfies Meta<typeof TicketEntryCode>

export default meta
type Story = StoryObj<typeof meta>

// The sheet body as the tickets page shows it, 360px wide.
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 360px">
			<ticket-entry-code
				class="[ flow ]"
				event-title.bind="eventTitle"
				numbers.bind="numbers"
				image.bind="image"
			></ticket-entry-code>
		</div>`,
		props: args,
		register: [TicketEntryCode],
	})

// A stand-in for the QR image, inline so the story needs no network.
const QR = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect x="1" y="1" width="6" height="6"/></svg>',
)}`

/** One code for three tickets, with who it presents. */
export const Code = {
	render,
	args: { image: QR },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('img')).toHaveAttribute('src', QR)
		const presented = canvasElement.querySelectorAll('.tickets-code-tickets li')
		await expect(presented).toHaveLength(3)
	},
} satisfies Story

/** The code is still being made: a line in place of the image. */
export const Making = {
	render,
	parameters: {
		a11y: {
			// The line sits on the code's white square and takes its colour from
			// the tickets page (`.tickets-lead`), which this story does not load,
			// so axe would measure a colour the page never draws.
			context: {
				include: ['body'],
				exclude: ['.tickets-code-figure > .tickets-lead'],
			},
		},
	},
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).queryByRole('img')).toBeNull()
		await expect(canvasElement.querySelector('.tickets-code-figure')).not.toBe(
			null,
		)
	},
} satisfies Story

/** Every ticket has entered: no code, only the note. */
export const AllEntered = {
	render,
	args: { numbers: [] },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.tickets-code-figure')).toBe(null)
		await expect(canvasElement.querySelector('.tickets-code-who')).toBe(null)
	},
} satisfies Story
