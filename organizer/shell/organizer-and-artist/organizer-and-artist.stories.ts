import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect } from 'storybook/test'
import { consoleStoryParameters } from '../../ui/story-support'
import { ArtistMenu } from '../artist-menu/artist-menu'
import { IConsoleContext } from '../console-context'
import { OrganizerAndArtist } from './organizer-and-artist'

const meta = {
	title: 'Console/Shell/OrganizerAndArtist',
	component: OrganizerAndArtist,
	parameters: consoleStoryParameters,
	argTypes: {
		deep: {
			control: 'boolean',
			description: 'Below a destination: the names keep to 45 % of the bar.',
		},
	},
	args: { deep: false },
} satisfies Meta<typeof OrganizerAndArtist>

export default meta
type Story = StoryObj<typeof meta>

const artist = (id: string, name: string) => ({
	id: { value: id },
	name: { value: name },
})

/** The console context with `names` as the represented Artists, the first worked on. */
const contextOf = (names: string[], organizerName = 'XX Records') => {
	const artists = names.map((name, i) => artist(`a-${i + 1}`, name))
	return {
		organizerId: 'org-1',
		organizerName,
		artists,
		artist: artists[0],
		artistId: 'a-1',
	}
}

/** The window width the bar's container query reads (`shell`). */
const render =
	(
		names: string[],
		windowWidth: number,
		organizerName?: string,
	): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<div style="container: shell / inline-size; inline-size:${windowWidth}px; display:flex; padding:8px; background:var(--md-sys-color-surface)">
					<organizer-and-artist deep.bind="deep"></organizer-and-artist>
				</div>
			`,
			props: args,
			register: [OrganizerAndArtist, ArtistMenu],
			items: [
				Registration.instance(IConsoleContext, contextOf(names, organizerName)),
			],
		})

/** One Artist on a compact window: the two names stacked, the Artist named only. */
export const OneArtist = {
	render: render(['Band A'], 400),
	play: async ({ canvasElement }) => {
		await expect(
			canvasElement.querySelector('[data-testid="artist-name"]')?.textContent,
		).toBe('Band A')
		await expect(canvasElement.querySelector('artist-menu')).toBeNull()
	},
} satisfies Story

/** Two or more Artists: the Artist is the Artist menu. */
export const SeveralArtists = {
	render: render(['Band A', 'Band B'], 400),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('artist-menu')).not.toBeNull()
		await expect(
			canvasElement.querySelector('[data-testid="artist-name"]'),
		).toBeNull()
	},
} satisfies Story

/** Medium and wider: the names side by side. */
export const Medium = {
	render: render(['Band A', 'Band B'], 720),
	play: async ({ canvasElement }) => {
		const context = canvasElement.querySelector<HTMLElement>('.context')
		if (!context) throw new Error('names not rendered')
		await expect(getComputedStyle(context).display).toBe('flex')
	},
} satisfies Story

/** Compact, below a destination: the names keep to 45 % of the bar. */
export const CompactBelowDestination = {
	args: { deep: true },
	render: render(['Band A', 'Band B'], 400),
	play: async ({ canvasElement }) => {
		const context = canvasElement.querySelector<HTMLElement>('.context')
		if (!context) throw new Error('names not rendered')
		await expect(getComputedStyle(context).maxInlineSize).toBe('45%')
	},
} satisfies Story

/** Compact: names too long for the bar shorten instead of widening it. */
export const LongNames = {
	render: render(
		['とても長い名前のアーティスト'.repeat(3)],
		390,
		'とても長い名前のレコード会社株式会社'.repeat(3),
	),
	play: async ({ canvasElement }) => {
		const bar = canvasElement.querySelector<HTMLElement>('[style*="container"]')
		const context = canvasElement.querySelector<HTMLElement>('.context')
		if (!bar || !context) throw new Error('names not rendered')
		// The bar does not scroll sideways and the names stay inside it.
		await expect(bar.scrollWidth - bar.clientWidth).toBe(0)
		await expect(context.getBoundingClientRect().right).toBeLessThanOrEqual(
			bar.getBoundingClientRect().right,
		)
		// The names are cut with an ellipsis rather than wrapped.
		const name = canvasElement.querySelector<HTMLElement>('.organizer-name')
		if (!name) throw new Error('organizer name not rendered')
		await expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
		await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
	},
} satisfies Story
