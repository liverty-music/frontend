import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { consoleStoryParameters } from '../../ui/story-support'
import { type ArtistChoice, ArtistMenu } from './artist-menu'

const ARTISTS: ArtistChoice[] = [
	{ id: 'a-1', name: 'Band A', href: '#a-1' },
	{ id: 'a-2', name: 'Band B', href: '#a-2' },
]

const meta = {
	title: 'Console/Shell/ArtistMenu',
	component: ArtistMenu,
	parameters: consoleStoryParameters,
	argTypes: {
		artists: { control: 'object' },
		currentId: { control: 'text' },
		currentName: { control: 'text' },
	},
	args: { artists: ARTISTS, currentId: 'a-1', currentName: 'Band A' },
} satisfies Meta<typeof ArtistMenu>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="container: shell / inline-size; inline-size:400px; display:grid; justify-items:end; min-block-size:200px; padding:8px; background:var(--md-sys-color-surface)">
				<artist-menu artists.bind="artists" current-id.bind="currentId" current-name.bind="currentName"></artist-menu>
			</div>
		`,
		props: args,
		register: [ArtistMenu],
	})

const buttonOf = (canvasElement: HTMLElement): HTMLButtonElement => {
	const button = canvasElement.querySelector<HTMLButtonElement>(
		'[data-testid="artist-menu-button"]',
	)
	if (!button) throw new Error('artist menu button not rendered')
	return button
}

/** Closed: the current Artist and a drop-down arrow. */
export const Closed = {
	render,
	play: async ({ canvasElement }) => {
		const button = buttonOf(canvasElement)
		await expect(button.textContent?.trim()).toBe('Band A')
		await expect(
			canvasElement.querySelector('.artist-menu')?.matches(':popover-open'),
		).toBe(false)
	},
} satisfies Story

/** Open: the represented Artists, the current one checked. */
export const Open = {
	render,
	play: async ({ canvasElement }) => {
		await userEvent.click(buttonOf(canvasElement))
		const menu = canvasElement.querySelector<HTMLElement>('.artist-menu')
		await waitFor(() => expect(menu?.matches(':popover-open')).toBe(true))
		const checks = [
			...canvasElement.querySelectorAll<HTMLElement>('.menu-check'),
		].map((check) => getComputedStyle(check).visibility)
		await expect(checks).toEqual(['visible', 'hidden'])
	},
} satisfies Story

/** A long name shortens with an ellipsis instead of wrapping. */
export const LongName = {
	args: {
		currentName:
			'A Very Long Artist Name That Does Not Fit In The Top App Bar At All',
	},
	render,
	play: async ({ canvasElement }) => {
		const name =
			buttonOf(canvasElement).querySelector<HTMLElement>('.artist-name')
		if (!name) throw new Error('artist name not rendered')
		await expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
		await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
	},
} satisfies Story
