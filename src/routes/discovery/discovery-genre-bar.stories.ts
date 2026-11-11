import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { DiscoveryGenreBar } from './discovery-genre-bar'

const meta = {
	title: 'Routes/Discovery/GenreBar',
	component: DiscoveryGenreBar,
	argTypes: {
		activeTag: {
			control: 'text',
			description:
				'The genre the bubbles are filtered by; its chip is pressed.',
		},
		isLoadingTag: {
			control: 'boolean',
			description: 'Bubbles are reloading; every chip is disabled.',
		},
	},
	args: { activeTag: '', isLoadingTag: false },
	globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<
	typeof DiscoveryGenreBar & { activeTag: string; isLoadingTag: boolean }
>

export default meta
type Story = StoryObj<typeof meta>

/** On Discovery's night sky, as the route draws it. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="display:grid; background:oklch(13% 0.027 262deg)">
			<discovery-genre-bar genre.bind="genre"></discovery-genre-bar>
		</div>`,
		props: {
			genre: {
				genreTags: ['J-Pop', 'Rock', 'Anime', 'Hip-Hop'],
				activeTag: args.activeTag,
				isLoadingTag: args.isLoadingTag,
			},
		},
		register: [DiscoveryGenreBar],
	})

/** No genre chosen: the reset chip, then every genre unpressed. */
export const Default = {
	render,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('button', { name: 'Rock' })).toHaveAttribute(
			'aria-pressed',
			'false',
		)
	},
} satisfies Story

/** A genre chosen: its chip is pressed and shows a check. */
export const Active = {
	render,
	args: { activeTag: 'Rock' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('button', { name: 'Rock' })).toHaveAttribute(
			'aria-pressed',
			'true',
		)
	},
} satisfies Story

/** Reloading: every chip, the reset one too, is disabled. */
export const Loading = {
	render,
	args: { isLoadingTag: true },
	play: async ({ canvasElement }) => {
		for (const chip of within(canvasElement).getAllByRole('button')) {
			await expect(chip).toBeDisabled()
		}
	},
} satisfies Story
