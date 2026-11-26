import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { ConcertDetails } from './concert-details'

const meta = {
	title: 'Components/ConcertDetails',
	component: ConcertDetails,
	argTypes: {
		dateLabel: { control: 'text', description: 'The formatted date.' },
		openTimeLabel: { control: 'text', description: 'Doors, e.g. 18:00.' },
		startTimeLabel: { control: 'text', description: 'Start, e.g. 19:00.' },
		zoneLabel: {
			control: 'text',
			description: "The venue's zone and the viewer's times, after the times.",
		},
		venueName: { control: 'text', description: "The venue's name." },
		prefecture: { control: 'text', description: "The venue's prefecture." },
	},
	args: {
		dateKey: '2026-11-20',
		dateLabel: '2026年11月20日(金)',
		openTimeLabel: '18:00',
		startTimeLabel: '19:00',
		zoneLabel: '',
		venueName: 'Zepp DiverCity',
		prefecture: '東京都',
		mapsUrl: 'https://maps.google.com/?q=Zepp',
	},
} satisfies Meta<typeof ConcertDetails>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="max-inline-size: 360px">
			<concert-details
				date-key.bind="dateKey"
				date-label.bind="dateLabel"
				open-time-label.bind="openTimeLabel"
				start-time-label.bind="startTimeLabel"
				zone-label.bind="zoneLabel"
				venue-name.bind="venueName"
				prefecture.bind="prefecture"
				maps-url.bind="mapsUrl"
			></concert-details>
		</div>`,
		props: args,
		register: [ConcertDetails],
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

/** A show abroad on a phone: the venue zone's name and the fan's times wrap below. */
export const Abroad = {
	render,
	globals: { viewport: { value: 'mobile1' } },
	args: {
		openTimeLabel: '18:30',
		startTimeLabel: '19:30',
		zoneLabel: 'ロンドン時間（日本時間 2月21日(日) 03:30 / 04:30）',
		venueName: 'The O2',
		prefecture: '',
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('event-zone')).toHaveTextContent(
			'ロンドン時間',
		)
	},
} satisfies Story
