import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
	finishMotion,
	nextPaint,
	pausableAnimations,
	seekMotion,
} from '../../../.storybook/motion'
import { transitionsEnded } from '../../../.storybook/transitions-ended'
import { StatePlaceholder } from '../../components/state-placeholder/state-placeholder'
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
					phase: 'answered',
					searchResults: [],
					...search,
				},
				followedIds: new Set(['a2']),
				follow: async () => {},
			},
			register: [
				DiscoverySearchResults,
				StatePlaceholder,
				BusyOnClickCustomAttribute,
			],
		})
}

/**
 * Each result is an `<li role="button">`, as on the Discovery screen before this
 * component existed; axe rejects the role on a list item, and then the list
 * that holds buttons. Changing the markup changes what a screen reader
 * announces, which that refactor must not do.
 */
const roleOnListItem = {
	a11y: {
		config: {
			rules: [
				{ id: 'aria-allowed-role', enabled: false },
				{ id: 'aria-required-children', enabled: false },
			],
		},
	},
}

/** The loading state: skeleton rows, and not the no-results message. */
const showsLoading: Story['play'] = async ({ canvasElement }) => {
	await expect(
		canvasElement.querySelectorAll('.skeleton-row').length,
	).toBeGreaterThan(0)
	await expect(canvasElement.querySelector('.search-status')).toBeNull()
}

/** Neither results, loading nor the no-results message. */
const showsNothing: Story['play'] = async ({ canvasElement }) => {
	await expect(canvasElement.querySelector('.skeleton-row')).toBeNull()
	await expect(canvasElement.querySelector('.search-status')).toBeNull()
	await expect(canvasElement.querySelector('.result-item')).toBeNull()
}

/** A single letter or digit is not searched: an empty list. */
export const Idle = {
	render: render({ phase: 'idle' }),
	play: showsNothing,
} satisfies Story

/** A query not sent yet. */
export const Waiting = {
	render: render({ phase: 'waiting' }),
	play: showsLoading,
} satisfies Story

/** A search in flight. */
export const Searching = {
	render: render({ phase: 'searching' }),
	play: showsLoading,
} satisfies Story

/** A refined query: the results already shown stay until it is answered. */
export const WaitingWithResults = {
	render: render({
		phase: 'waiting',
		searchResults: [artist('a1', 'Vaundy'), artist('a2', 'YOASOBI')],
	}),
	parameters: roleOnListItem,
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getAllByRole('button')).toHaveLength(2)
		await expect(canvasElement.querySelector('.skeleton-row')).toBeNull()
	},
} satisfies Story

/** A failed search: the snack says so, the list shows nothing. */
export const Failed = {
	render: render({ phase: 'failed' }),
	play: showsNothing,
} satisfies Story

/** Nothing found: the no-results status. */
export const NoResults = {
	render: render({}),
	play: async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('.search-status')).not.toBeNull()
		await expect(canvasElement.querySelector('.result-item')).toBeNull()
	},
} satisfies Story

/** Results: an artist to follow, and one already followed (checked, dimmed). */
export const Results = {
	render: render({
		searchResults: [artist('a1', 'Vaundy'), artist('a2', 'YOASOBI')],
	}),
	parameters: roleOnListItem,
	play: async ({ canvasElement }) => {
		const rows = within(canvasElement).getAllByRole('button')
		await expect(rows).toHaveLength(2)
		// The M3 leading avatar: a 40 px circle.
		for (const avatar of canvasElement.querySelectorAll('.result-avatar')) {
			const box = avatar.getBoundingClientRect()
			await expect([box.width, box.height]).toEqual([40, 40])
		}
		await expect(rows[0]).toHaveAttribute('data-followed', 'false')
		await expect(rows[1]).toHaveAttribute('data-followed', 'true')
		// The rows fade in and end at their own opacity: a followed one dimmed.
		await transitionsEnded(canvasElement)
		await expect(getComputedStyle(rows[0]).opacity).toBe('1')
		await expect(getComputedStyle(rows[1]).opacity).toBe('0.5')

		// The list fades in and out with search (the route hides it outside
		// search with `display: none`, flipped after the exit).
		const style = getComputedStyle(
			canvasElement.querySelector('.search-results') as Element,
		)
		await expect(style.transitionProperty).toContain('opacity')
		await expect(style.transitionProperty).toContain('display')
	},
} satisfies Story

/**
 * The results fade in when search starts and out when it ends. The route hides
 * them outside search with `display: none` and `opacity: 0`; the story does
 * the same and shows them again, and steps through the fade.
 */
export const FadesWithSearch = {
	render: render({
		searchResults: [artist('a1', 'Vaundy'), artist('a2', 'YOASOBI')],
	}),
	parameters: roleOnListItem,
	play: async ({ canvasElement }) => {
		const results = canvasElement.querySelector(
			'.search-results',
		) as HTMLElement
		await transitionsEnded(results)
		// Search ends: the results fade out, then leave rendering.
		results.style.display = 'none'
		results.style.opacity = '0'
		await nextPaint()
		await transitionsEnded(results)
		await expect(getComputedStyle(results).display).toBe('none')
		// Search starts: they fade in from nothing.
		results.style.display = ''
		results.style.opacity = ''
		const fade = pausableAnimations(results).filter(
			(a) => (a as CSSTransition).transitionProperty === 'opacity',
		)
		await expect(fade).toHaveLength(1)
		const opacity = () => Number.parseFloat(getComputedStyle(results).opacity)
		// @spec components/infrastructure/fan/web/route/discovery "Starting a search"
		await expect(Number(fade[0].effect?.getComputedTiming().duration)).toBe(200)
		await seekMotion(fade, 0)
		await expect(opacity()).toBeLessThan(0.2)
		await seekMotion(fade, 0.1)
		await expect(opacity()).toBeGreaterThan(0.2)
		await expect(opacity()).toBeLessThan(1)
		finishMotion(fade)
		await transitionsEnded(results)
		await expect(opacity()).toBe(1)
	},
} satisfies Story

/**
 * A row can take keyboard focus and follows its artist on Enter or Space; a
 * row already followed is skipped, and the arrows move between the rows left.
 */
const keyFollow = fn(async () => {})

export const ResultsFromTheKeyboard = {
	parameters: Results.parameters,
	render: () => {
		return defineAureliaStory({
			template: `<div style="display:grid; min-block-size:320px; background:oklch(13% 0.027 262deg)">
				<discovery-search-results
					search.bind="search"
					followed-ids.bind="followedIds"
					follow.trigger="$event.detail.waitUntil(follow())"
				></discovery-search-results>
			</div>`,
			props: {
				search: {
					phase: 'answered',
					searchResults: [
						artist('a1', 'Vaundy'),
						artist('a2', 'YOASOBI'),
						artist('a3', 'Yorushika'),
					],
				},
				followedIds: new Set(['a2']),
				follow: keyFollow,
			},
			register: [
				DiscoverySearchResults,
				StatePlaceholder,
				BusyOnClickCustomAttribute,
			],
		})
	},
	play: async ({ canvasElement }) => {
		const rows = [
			...canvasElement.querySelectorAll<HTMLElement>('.result-item'),
		]
		// One Tab stop for the group; the followed row is not in it.
		await expect(rows.map((r) => r.getAttribute('tabindex'))).toEqual([
			'0',
			null,
			'-1',
		])

		rows[0].focus()
		await userEvent.keyboard('{ArrowDown}')
		// The followed row is skipped.
		await expect(document.activeElement).toBe(rows[2])
		await userEvent.keyboard('{ArrowDown}')
		await expect(document.activeElement).toBe(rows[0])

		// Enter follows the focused artist, and so does Space.
		keyFollow.mockClear()
		await userEvent.keyboard('{Enter}')
		await expect(keyFollow).toHaveBeenCalledTimes(1)
		await userEvent.keyboard(' ')
		await expect(keyFollow).toHaveBeenCalledTimes(2)
	},
} satisfies Story
