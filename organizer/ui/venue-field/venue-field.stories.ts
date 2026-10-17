import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { Registration } from 'aurelia'
import { expect, fn, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import { IVenueClient } from '../../services/venue-client'
import {
	canvasOf,
	consoleStoryParameters,
	contrastRatio,
	deepQuery,
	deepQueryAll,
	focusedElement,
} from '../story-support'
import { SEARCH_DELAY_MS, VenueField, type VenuePick } from './venue-field'

const meta = {
	title: 'Console/VenueField',
	component: VenueField,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		label: { control: 'text' },
		error: { control: 'text', description: 'Catalog key of the error.' },
		required: { control: 'boolean' },
	},
	args: { label: '会場', error: '', required: true },
} satisfies Meta<typeof VenueField>

export default meta
type Story = StoryObj<typeof meta>

const HANEDA: VenuePick = {
	placeId: 'ChIJ-haneda',
	name: 'Zepp Haneda (TOKYO)',
	address: '東京都大田区羽田空港1-1-4',
}
const DIVERCITY: VenuePick = {
	placeId: 'ChIJ-divercity',
	name: 'Zepp DiverCity (TOKYO)',
	address: '東京都江東区青海1-1-10',
}
const BUDOKAN: VenuePick = {
	placeId: 'ChIJ-budokan',
	name: '日本武道館',
	address: '東京都千代田区北の丸公園2-3',
}
const LIQUIDROOM: VenuePick = {
	placeId: 'ChIJ-liquidroom',
	name: 'LIQUIDROOM',
	address: '東京都渋谷区東3-16-6',
}

type Search = (text: string, signal?: AbortSignal) => Promise<VenuePick[]>

/**
 * A story whose field searches a mocked venue client (registered in the
 * story's container in place of `IVenueClient`). `client.search` records the
 * calls the play function checks.
 */
function venueStory(
	search: Search,
	options: { value?: VenuePick | null; scheme?: 'light' | 'dark' } = {},
) {
	const client = { search: fn(search) }
	const render: Story['render'] = (args) => {
		client.search.mockClear()
		return defineAureliaStory({
			template: `
				<div style="color-scheme:${options.scheme ?? 'light'}; inline-size:390px; padding:16px; background:var(--md-color-surface)">
					<venue-field label.bind="label" error.bind="error" required.bind="required" value.bind="value" typed-not-picked.bind="typedNotPicked"></venue-field>
					<p style="color:var(--md-color-on-surface)" data-testid="value">\${value ? value.placeId : 'none'}</p>
					<p style="color:var(--md-color-on-surface)" data-testid="typed">\${typedNotPicked ? 'typed' : 'clean'}</p>
				</div>
			`,
			props: { ...args, value: options.value ?? null, typedNotPicked: false },
			items: [Registration.instance(IVenueClient, client)],
		})
	}
	return { client, render }
}

const combobox = (root: HTMLElement) =>
	canvasOf(root).getByRole('combobox', { name: /会場/ })

/** Waits longer than the field's pause, so a search would have started. */
const pause = () =>
	new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 300))

/** The list open with its options, after the pause and the answer. */
async function openList(root: HTMLElement): Promise<HTMLElement[]> {
	// Resolved outside `waitFor`: `canvasOf` sets an attribute, and a mutation
	// inside the callback would wake `waitFor`'s observer forever.
	const input = combobox(root)
	await waitFor(
		() => expect(input.element()).toHaveAttribute('aria-expanded', 'true'),
		{ timeout: 3000 },
	)
	return deepQueryAll(root, '[role="option"]')
}

const statusOf = (root: HTMLElement) => deepQuery(root, '[role="status"]')

const empty = venueStory(async () => [])

/** Nothing typed: a closed combobox, its hint, no list. */
export const Empty = {
	render: empty.render,
	play: async ({ canvasElement }) => {
		const input = combobox(canvasElement).element()
		await expect(input).toHaveAttribute('aria-expanded', 'false')
		await expect(input).toHaveAttribute('aria-autocomplete', 'list')
		const listbox = deepQuery(canvasElement, '[role="listbox"]')
		await expect(input).toHaveAttribute('aria-controls', listbox.id)
		await expect(listbox).not.toBeVisible()
		await expect(input).toHaveAccessibleDescription(/候補を表示します/)
		await expect(empty.client.search).not.toHaveBeenCalled()
	},
} satisfies Story

const shortLatin = venueStory(async () => [HANEDA])

/** "Zepp" is too broad: no search below 5 Latin characters. */
export const TypingShortLatin = {
	render: shortLatin.render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Short Latin text"
		await userEvent.fill(combobox(canvasElement), 'Zepp')
		await pause()
		await expect(shortLatin.client.search).not.toHaveBeenCalled()
		await expect(combobox(canvasElement).element()).toHaveAttribute(
			'aria-expanded',
			'false',
		)
		// Typed but not picked: the screen can tell the member to pick.
		await expect(
			canvasOf(canvasElement).getByTestId('typed').element(),
		).toHaveTextContent('typed')

		await userEvent.fill(combobox(canvasElement), 'Zepp H')
		await openList(canvasElement)
		await expect(shortLatin.client.search).toHaveBeenCalledTimes(1)
		await expect(shortLatin.client.search.mock.calls[0][0]).toBe('Zepp H')
	},
} satisfies Story

const japanese = venueStory(async () => [BUDOKAN])

/** 「武道館」 searches at 3 characters, without any other action. */
export const JapaneseThreeCharacters = {
	render: japanese.render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Short Japanese name"
		await userEvent.fill(combobox(canvasElement), '武道館')
		const options = await openList(canvasElement)
		await expect(japanese.client.search).toHaveBeenCalledTimes(1)
		await expect(japanese.client.search.mock.calls[0][0]).toBe('武道館')
		await expect(options).toHaveLength(1)
		await expect(options[0]).toHaveTextContent('日本武道館')
	},
} satisfies Story

const results = venueStory(async () => [HANEDA, DIVERCITY])

/** Down, down, Enter picks the second place and closes the list. */
export const ResultsKeyboardPick = {
	render: results.render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Keyboard pick"
		await userEvent.fill(combobox(canvasElement), 'Zepp Haneda')
		const options = await openList(canvasElement)
		await expect(options.map((o) => o.textContent?.trim())).toEqual([
			expect.stringContaining('Zepp Haneda (TOKYO)'),
			expect.stringContaining('Zepp DiverCity (TOKYO)'),
		])
		await expect(options[1]).toHaveTextContent('東京都江東区青海1-1-10')

		// The list credits its source inside its own container, untranslated.
		const credit = deepQuery(canvasElement, '.popup .attribution')
		await expect(credit).toHaveTextContent('Google Maps')
		await expect(credit).toHaveAttribute('translate', 'no')
		await expect(credit).toBeVisible()

		const input = combobox(canvasElement).element()
		await userEvent.keyboard('{ArrowDown}')
		await expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
		await expect(options[0]).toHaveAttribute('aria-selected', 'true')
		await userEvent.keyboard('{ArrowDown}')
		await expect(input).toHaveAttribute('aria-activedescendant', options[1].id)
		await userEvent.keyboard('{Enter}')

		const value = canvasOf(canvasElement).getByTestId('value')
		await waitFor(() =>
			expect(value.element()).toHaveTextContent('ChIJ-divercity'),
		)
		await expect(deepQueryAll(canvasElement, '[role="listbox"]')).toHaveLength(
			0,
		)
		const picked = deepQuery(canvasElement, '[data-role="picked"]')
		await expect(picked).toHaveTextContent('Zepp DiverCity (TOKYO)')
		await expect(picked).toHaveTextContent('東京都江東区青海1-1-10')
		// Focus lands on 変更, the only control left in the field.
		const change = canvasOf(canvasElement).getByRole('button', { name: '変更' })
		await waitFor(() => expect(focusedElement()).toBe(change.element()))
	},
} satisfies Story

const pointer = venueStory(async () => [HANEDA, DIVERCITY])

/** A pointer press picks the place; Escape closed the list before. */
export const PointerPickAndEscape = {
	render: pointer.render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Pick a venue"
		await userEvent.fill(combobox(canvasElement), 'Zepp Haneda')
		await openList(canvasElement)
		await userEvent.keyboard('{Escape}')
		await expect(combobox(canvasElement).element()).toHaveAttribute(
			'aria-expanded',
			'false',
		)
		// ArrowDown opens the list again on the same answer.
		await userEvent.keyboard('{ArrowDown}')
		const options = await openList(canvasElement)
		await userEvent.click(options[0])
		const value = canvasOf(canvasElement).getByTestId('value')
		await waitFor(() =>
			expect(value.element()).toHaveTextContent('ChIJ-haneda'),
		)
		await expect(pointer.client.search).toHaveBeenCalledTimes(1)
	},
} satisfies Story

const noMatch = venueStory(async () => [])

export const NoMatch = {
	render: noMatch.render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "No match"
		await userEvent.fill(combobox(canvasElement), 'どこにもない会場')
		await waitFor(
			() =>
				expect(statusOf(canvasElement)).toHaveTextContent(
					'会場が見つかりませんでした。別の名前で検索してください。',
				),
			{ timeout: 3000 },
		)
		await expect(combobox(canvasElement).element()).toHaveAttribute(
			'aria-expanded',
			'false',
		)
		await expect(
			canvasOf(canvasElement).getByTestId('value').element(),
		).toHaveTextContent('none')
	},
} satisfies Story

let unavailableAttempts = 0
const unavailable = venueStory(async () => {
	unavailableAttempts++
	if (unavailableAttempts === 1) throw new Error('Unavailable')
	return [HANEDA]
})

export const UnavailableWithRetry = {
	render: (args, context) => {
		unavailableAttempts = 0
		return unavailable.render?.(args, context)
	},
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Search unavailable"
		const canvas = canvasOf(canvasElement)
		await userEvent.fill(combobox(canvasElement), 'Zepp Haneda')
		await waitFor(
			() =>
				expect(statusOf(canvasElement)).toHaveTextContent(
					'会場を検索できません。',
				),
			{ timeout: 3000 },
		)
		await expect(canvas.getByTestId('value').element()).toHaveTextContent(
			'none',
		)

		await userEvent.click(canvas.getByRole('button', { name: '再試行' }))
		const options = await openList(canvasElement)
		await expect(options[0]).toHaveTextContent('Zepp Haneda (TOKYO)')
		await expect(unavailable.client.search).toHaveBeenCalledTimes(2)
		// 再試行 leaves the member in the input.
		await expect(focusedElement()).toBe(combobox(canvasElement).element())
	},
} satisfies Story

const picked = venueStory(async () => [HANEDA], { value: HANEDA })

/** A picked place shows its name and address and can be changed. */
export const Picked = {
	render: picked.render,
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const place = deepQuery(canvasElement, '[data-role="picked"]')
		await expect(place).toHaveTextContent('Zepp Haneda (TOKYO)')
		await expect(place).toHaveTextContent('東京都大田区羽田空港1-1-4')

		await userEvent.click(canvas.getByRole('button', { name: '変更' }))
		const input = combobox(canvasElement)
		await waitFor(() => expect(focusedElement()).toBe(input.element()))
		await expect(combobox(canvasElement).element()).toHaveValue(
			'Zepp Haneda (TOKYO)',
		)
		await expect(canvas.getByTestId('value').element()).toHaveTextContent(
			'none',
		)
		await expect(canvas.getByTestId('typed').element()).toHaveTextContent(
			'typed',
		)
		// Changing does not search by itself; typing does.
		await pause()
		await expect(picked.client.search).not.toHaveBeenCalled()
	},
} satisfies Story

/** Two answers the play function releases in the order it wants. */
const pending = new Map<string, (found: VenuePick[]) => void>()
const signals = new Map<string, AbortSignal | undefined>()
const stale = venueStory(
	(text, signal) =>
		new Promise((resolve) => {
			pending.set(text, resolve)
			signals.set(text, signal)
		}),
)

/** "LIQUID", a pause, then "ROOM": the late answer for LIQUID is dropped. */
export const StaleAnswerDropped = {
	render: (args, context) => {
		pending.clear()
		signals.clear()
		return stale.render?.(args, context)
	},
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Typing on"
		await userEvent.fill(combobox(canvasElement), 'LIQUID')
		await waitFor(() => expect(pending.has('LIQUID')).toBe(true), {
			timeout: 3000,
		})
		await userEvent.fill(combobox(canvasElement), 'LIQUIDROOM')
		await waitFor(() => expect(pending.has('LIQUIDROOM')).toBe(true), {
			timeout: 3000,
		})
		// The newer text aborted the request in flight.
		await expect(signals.get('LIQUID')?.aborted).toBe(true)

		pending.get('LIQUIDROOM')?.([LIQUIDROOM])
		await openList(canvasElement)
		// The first answer arrives after the second one and is not shown.
		pending.get('LIQUID')?.([HANEDA, DIVERCITY])
		await pause()
		const options = deepQueryAll(canvasElement, '[role="option"]')
		await expect(options).toHaveLength(1)
		await expect(options[0]).toHaveTextContent('LIQUIDROOM')
	},
} satisfies Story

const dark = venueStory(async () => [HANEDA, DIVERCITY], { scheme: 'dark' })

/** The open list reads at 4.5:1 or more in dark mode, the active option too. */
export const OpenListInDarkMode = {
	render: dark.render,
	play: async ({ canvasElement }) => {
		await userEvent.fill(combobox(canvasElement), 'Zepp Haneda')
		await openList(canvasElement)
		await userEvent.keyboard('{ArrowDown}')

		const popup = deepQuery(canvasElement, '.popup')
		const surface = getComputedStyle(popup).backgroundColor
		const active = deepQuery(canvasElement, '[aria-selected="true"]')
		const activeSurface = getComputedStyle(active).backgroundColor
		const checks: Array<[string, string]> = [
			['.option:not([aria-selected="true"]) .option-name', surface],
			['.option:not([aria-selected="true"]) .option-address', surface],
			['.attribution', surface],
			['[aria-selected="true"] .option-name', activeSurface],
			['[aria-selected="true"] .option-address', activeSurface],
		]
		for (const [selector, background] of checks) {
			const color = getComputedStyle(deepQuery(canvasElement, selector)).color
			await expect(
				contrastRatio(color, background),
				selector,
			).toBeGreaterThanOrEqual(4.5)
		}
		// The dark scheme applies: the list's surface is closer to black than white.
		await expect(contrastRatio(surface, 'black')).toBeLessThan(
			contrastRatio(surface, 'white'),
		)
	},
} satisfies Story

/** The screen's "must pick" error, translated by the field. */
export const NotPicked = {
	args: { error: 'concertEditor.error.venueNotPicked' },
	render: empty.render,
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/route/concert-editor "Typed name not picked"
		const input = combobox(canvasElement).element()
		await expect(input).toHaveAttribute('aria-invalid', 'true')
		await expect(input).toHaveAccessibleDescription(
			/検索結果から会場を選んでください/,
		)
	},
} satisfies Story
