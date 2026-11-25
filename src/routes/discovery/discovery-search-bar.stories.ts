import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, within } from 'storybook/test'
import { DiscoverySearchBar } from './discovery-search-bar'

const meta = {
	title: 'Routes/Discovery/SearchBar',
	component: DiscoverySearchBar,
	argTypes: {
		query: {
			control: 'text',
			description: 'The search query; a non-empty one shows the clear button.',
		},
	},
	args: { query: '' },
	globals: { viewport: { value: 'mobile1', isRotated: false } },
} satisfies Meta<typeof DiscoverySearchBar & { query: string }>

export default meta
type Story = StoryObj<typeof meta>

/** On Discovery's night sky, as the route draws it; the host clears the query. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="display:grid; padding-block:8px; background:oklch(13% 0.027 262deg)">
			<discovery-search-bar search.bind="search" search-clear.trigger="search.searchQuery = ''"></discovery-search-bar>
		</div>`,
		props: { search: { searchQuery: args.query } },
		register: [DiscoverySearchBar],
	})

/** No query: the field alone. */
export const Empty = {
	render,
	args: { query: '' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('textbox')).toBeVisible()
		await expect(canvas.queryByRole('button')).toBeNull()
		// @spec components/infrastructure/fan/web/route/discovery "The search bar is 56 px tall"
		// The M3 search bar's height on a 320 px phone too.
		const bar = canvasElement.querySelector('.search-bar') as HTMLElement
		await expect(bar.getBoundingClientRect().height).toBe(56)
	},
} satisfies Story

/** A query: the clear button, which empties the field. */
export const WithQuery = {
	render,
	args: { query: 'YOASOBI' },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(canvas.getByRole('textbox')).toHaveValue('YOASOBI')
		await userEvent.click(canvas.getByRole('button'))
		await expect(canvas.getByRole('textbox')).toHaveValue('')
		await expect(canvas.queryByRole('button')).toBeNull()
	},
} satisfies Story
