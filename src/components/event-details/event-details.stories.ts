import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { EventDetails } from './event-details'

const meta = {
	title: 'Components/EventDetails',
	component: EventDetails,
	argTypes: {
		dateLabel: { control: 'text', description: 'The formatted date.' },
		openTimeLabel: { control: 'text', description: 'Doors, e.g. 18:00.' },
		startTimeLabel: { control: 'text', description: 'Start, e.g. 19:00.' },
		venueName: { control: 'text', description: "The venue's name." },
		prefecture: { control: 'text', description: "The venue's prefecture." },
	},
	args: {
		dateKey: '2026-11-20',
		dateLabel: '2026年11月20日(金)',
		openTimeLabel: '18:00',
		startTimeLabel: '19:00',
		venueName: 'Zepp DiverCity',
		prefecture: '東京都',
		mapsUrl: 'https://maps.google.com/?q=Zepp',
	},
} satisfies Meta<typeof EventDetails>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="inline-size: 360px">
			<event-details
				date-key.bind="dateKey"
				date-label.bind="dateLabel"
				open-time-label.bind="openTimeLabel"
				start-time-label.bind="startTimeLabel"
				venue-name.bind="venueName"
				prefecture.bind="prefecture"
				maps-url.bind="mapsUrl"
			></event-details>
		</div>`,
		props: args,
		register: [EventDetails],
	})

/** Date with doors and start, then the venue, its prefecture and the map link. */
export const Full = {
	render,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('event-date')).toHaveTextContent(
			'2026年11月20日(金)',
		)
		await expect(canvas.getByTestId('event-times')).toHaveTextContent('19:00')
		await expect(canvas.getByTestId('event-prefecture')).toBeVisible()
	},
} satisfies Story

/** No times and no prefecture known: only the date and the venue. */
export const DateAndVenueOnly = {
	render,
	args: { openTimeLabel: '', startTimeLabel: '', prefecture: '' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('event-times')).toHaveTextContent('')
		await expect(canvas.queryByTestId('event-prefecture')).toBeNull()
		await expect(canvas.getByTestId('event-maps')).toBeVisible()
	},
} satisfies Story
