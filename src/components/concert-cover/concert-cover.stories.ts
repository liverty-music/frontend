import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor, within } from 'storybook/test'
import { ConcertCover } from './concert-cover'

const meta = {
	title: 'Components/ConcertCover',
	component: ConcertCover,
	argTypes: {
		url: {
			control: 'text',
			description: "The cover image's URL; empty shows the placeholder.",
		},
	},
	args: { url: '' },
} satisfies Meta<typeof ConcertCover>

export default meta
type Story = StoryObj<typeof meta>

// A 360px column: the narrowest supported phone.
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template:
			'<div style="inline-size: 360px"><concert-cover url.bind="url"></concert-cover></div>',
		props: args,
		register: [ConcertCover],
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
		await expect(canvas.getByTestId('concert-cover')).toHaveAttribute(
			'src',
			IMAGE,
		)
		await expect(canvas.queryByTestId('concert-cover-placeholder')).toBeNull()
	},
} satisfies Story

/** No image: the brand placeholder with a music note. */
export const Placeholder = {
	render,
	args: { url: '' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByTestId('concert-cover-placeholder')).toBeVisible()
		await expect(canvas.queryByTestId('concert-cover')).toBeNull()
	},
} satisfies Story

/**
 * The image fades in over the cover's box once it has loaded: it is
 * transparent before its `load` event and opaque after it, and the box that
 * held its room is the same size throughout, so nothing moves.
 */
export const ImageFadesIn = {
	render,
	args: { url: IMAGE },
	play: async ({ canvasElement }) => {
		const img = within(canvasElement).getByTestId('concert-cover')
		const box = canvasElement.querySelector('.concert-cover') as HTMLElement
		await waitFor(() => expect(img).toHaveAttribute('data-loaded', 'true'))
		await waitFor(() => expect(getComputedStyle(img).opacity).toBe('1'))
		const settled = box.getBoundingClientRect().height

		// A different image starts transparent again and fades in on its load.
		img.dispatchEvent(new Event('load'))
		await expect(box.getBoundingClientRect().height).toBe(settled)
		await expect(getComputedStyle(img).transitionProperty).toBe('opacity')
	},
} satisfies Story
