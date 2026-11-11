import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { BusyOnClickCustomAttribute } from '../../custom-attributes/busy-on-click'
import { DiscoverySearchResults } from './discovery-search-results'

const meta = {
	title: 'Routes/Discovery/SearchResults',
	component: DiscoverySearchResults,
	globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof DiscoverySearchResults>

export default meta
type Story = StoryObj<typeof meta>

const artist = (id: string, name: string) => ({ id, name, mbid: '' })

/** On Discovery's night sky, as the route draws it. */
function render(search: Record<string, unknown>): Story['render'] {
	return () =>
		defineAureliaStory({
			template: `<div style="display:grid; min-block-size:320px; background:oklch(13% 0.027 262deg)">
				<discovery-search-results
					search.bind="search"
					followed-ids.bind="followedIds"
					follow.trigger="$event.detail.waitUntil(follow())"
				></discovery-search-results>
			</div>`,
			props: {
				search: {
					isSearching: false,
					isSearchMode: true,
					searchQuery: '',
					searchResults: [],
					...search,
				},
				followedIds: new Set(['a2']),
				follow: async () => {},
			},
			register: [DiscoverySearchResults, BusyOnClickCustomAttribute],
		})
}

/** A search in flight: the searching status. */
export const Searching = {
	render: render({ isSearching: true, searchQuery: 'YOA' }),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.search-status')).not.toBeNull()
	},
} satisfies Story

/** Nothing found: the no-results status. */
export const NoResults = {
	render: render({ searchQuery: 'zzzz' }),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.search-status')).not.toBeNull()
		await expect(canvasElement.querySelector('.result-item')).toBeNull()
	},
} satisfies Story

/** Results: an artist to follow, and one already followed (checked, dimmed). */
export const Results = {
	render: render({
		searchQuery: 'Y',
		searchResults: [artist('a1', 'Vaundy'), artist('a2', 'YOASOBI')],
	}),
	parameters: {
		a11y: {
			config: {
				// Each result is an `<li role="button">`, as on the Discovery
				// screen before this component existed; axe rejects the role on a
				// list item. Changing the markup changes what a screen reader
				// announces, which this refactor must not do. The list then holds
				// buttons rather than list items, which axe also reports.
				rules: [
					{ id: 'aria-allowed-role', enabled: false },
					{ id: 'aria-required-children', enabled: false },
				],
			},
		},
	},
	play: async ({ canvasElement }) => {
		const rows = within(canvasElement).getAllByRole('button')
		await expect(rows).toHaveLength(2)
		await expect(rows[0]).toHaveAttribute('data-followed', 'false')
		await expect(rows[1]).toHaveAttribute('data-followed', 'true')
	},
} satisfies Story
