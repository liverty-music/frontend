import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
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

/** The search controller's two ways in; nothing is really searched. */
const submit = fn()
const searchNow = fn()

/** On Discovery's night sky, as the route draws it; the host clears the query. */
const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="display:grid; padding-block:8px; background:oklch(13% 0.027 262deg)">
			<discovery-search-bar search.bind="search" search-clear.trigger="search.searchQuery = ''"></discovery-search-bar>
		</div>`,
		props: { search: { searchQuery: args.query, submit, searchNow } },
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

/** Enter, the keyboard's search key, searches at once. */
export const Enter = {
	render,
	args: { query: '' },
	play: async ({ canvasElement }) => {
		const input = within(canvasElement).getByRole('textbox')
		await expect(input).toHaveAttribute('enterkeyhint', 'search')
		searchNow.mockClear()
		await userEvent.type(input, 'Vaundy')
		await expect(searchNow).not.toHaveBeenCalled()
		await userEvent.keyboard('{Enter}')
		await expect(searchNow).toHaveBeenCalledTimes(1)
	},
} satisfies Story

/** The Enter that confirms an input method conversion does not search. */
export const ComposingEnter = {
	render,
	args: { query: 'ばうんでぃ' },
	play: async ({ canvasElement }) => {
		const input = within(canvasElement).getByRole('textbox')
		searchNow.mockClear()
		for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
			input.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: 'Enter',
					bubbles: true,
					...init,
				}),
			)
		}
		await expect(searchNow).not.toHaveBeenCalled()
	},
} satisfies Story
