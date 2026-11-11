import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { EventCover } from './event-cover'

const meta = {
	title: 'Components/EventCover',
	component: EventCover,
	argTypes: {
		url: {
			control: 'text',
			description: "The cover image's URL; empty shows the placeholder.",
		},
	},
	args: { url: '' },
} satisfies Meta<typeof EventCover>

export default meta
type Story = StoryObj<typeof meta>

// A 360px column: the narrowest supported phone.
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template:
			'<div style="inline-size: 360px"><event-cover url.bind="url"></event-cover></div>',
		props: args,
		register: [EventCover],
	})

// A flat 16:9 image, inline so the story needs no network.
const IMAGE = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#345"/></svg>',
)}`

/** The event's own image fills the 16:9 frame. */
export const WithImage = {
	render,
	args: { url: IMAGE },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('event-cover')).toHaveAttribute(
			'src',
			IMAGE,
		)
		await expect(canvas.queryByTestId('event-cover-placeholder')).toBeNull()
	},
} satisfies Story

/** No image: the brand placeholder with a music note. */
export const Placeholder = {
	render,
	args: { url: '' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('event-cover-placeholder')).toBeVisible()
		await expect(canvas.queryByTestId('event-cover')).toBeNull()
	},
} satisfies Story
