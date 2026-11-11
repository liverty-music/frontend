import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { CustomElement } from 'aurelia'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { resolveColor } from '../../../.storybook/contrast'
import { ArtistFilterBar } from './artist-filter-bar'

const meta = {
	title: 'Components/ArtistFilterBar',
	component: ArtistFilterBar,
	args: { isAuthenticated: false },
} satisfies Meta<typeof ArtistFilterBar>

export default meta
type Story = StoryObj<typeof meta>

/** Followed artists with upcoming concerts, already counted and ordered. */
const ARTISTS = [
	{ id: 'a1', name: 'YOASOBI', count: 3 },
	{ id: 'a2', name: 'Vaundy', count: 2 },
	{ id: 'a3', name: 'Ado', count: 1 },
]

/**
 * The filter sheet as the dashboard binds it. The two outputs show the
 * committed selection, which only the confirm button may change.
 */
const render =
	(selectedIds: string[] = []): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<output id="committed-artists">\${selectedIds.join(',')}</output>
				<output id="committed-statuses">\${selectedStatuses.join(',')}</output>
				<artist-filter-bar
					counted-artists.bind="artists"
					selected-ids.two-way="selectedIds"
					selected-statuses.two-way="selectedStatuses"
					is-authenticated.bind="isAuthenticated"
				></artist-filter-bar>
			`,
			props: { ...args, artists: ARTISTS, selectedIds, selectedStatuses: [] },
			register: [ArtistFilterBar],
		})

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const barOf = (root: HTMLElement) =>
	CustomElement.for<ArtistFilterBar>(
		root.querySelector('artist-filter-bar') as HTMLElement,
	).viewModel

/** Opens the sheet as the launcher's filter action does, and waits for it. */
async function openFilter(root: HTMLElement): Promise<HTMLDialogElement> {
	barOf(root).openSheet()
	const dialog = root.querySelector('dialog') as HTMLDialogElement
	await waitFor(() => expect(dialog.matches(':popover-open')).toBe(true))
	const body = root.querySelector('.sheet-body') as HTMLElement
	await waitFor(() =>
		expect(
			Math.abs(body.getBoundingClientRect().bottom - innerHeight),
		).toBeLessThan(1),
	)
	// The scroll that put the sheet there has ended.
	await pause(300)
	return dialog
}

/** Taps the dimmed area and waits for the sheet to have closed. */
async function dismiss(root: HTMLElement): Promise<void> {
	let hidden = false
	root.addEventListener('sheet-hidden', () => {
		hidden = true
	})
	await userEvent.click(root.querySelector('.dismiss-zone') as HTMLElement)
	await waitFor(() => expect(hidden).toBe(true), { timeout: 3000 })
}

const chipOf = (root: HTMLElement, name: string) =>
	[...root.querySelectorAll<HTMLElement>('label.artist-chip')].find((chip) =>
		chip.textContent?.includes(name),
	) as HTMLElement

const checkedIds = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLInputElement>('.artists-list input')]
		.filter((input) => input.checked)
		.map((input) => input.closest('label')?.textContent?.replace(/\s+/g, ''))

const committed = (root: HTMLElement, id = 'committed-artists') =>
	root.querySelector(`#${id}`)?.textContent

/** Each artist's chip leads with its upcoming-concert count, in the given order. */
export const ChipsWithCounts = {
	render: render(),
	play: async ({ canvasElement }) => {
		await openFilter(canvasElement)
		const chips = [...canvasElement.querySelectorAll('label.artist-chip')]

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Artist chip shows upcoming-concert count"
		await expect(chips).toHaveLength(ARTISTS.length)
		for (const [i, artist] of ARTISTS.entries()) {
			const count = chips[i].querySelector('.artist-count') as HTMLElement
			await expect(count.textContent).toBe(String(artist.count))
			// The count comes before the name.
			await expect(chips[i].textContent?.replace(/\s+/g, '')).toBe(
				`${artist.count}${artist.name}`,
			)
		}

		await dismiss(canvasElement)
	},
} satisfies Story

/** The sheet opens with the committed filter already selected. */
export const CurrentFilterPreselected = {
	render: render(['a2']),
	play: async ({ canvasElement }) => {
		await openFilter(canvasElement)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Pre-selecting current filter"
		await expect(checkedIds(canvasElement)).toEqual(['2Vaundy'])
		const chip = chipOf(canvasElement, 'Vaundy')
		await expect(getComputedStyle(chip).backgroundColor).toBe(
			resolveColor(canvasElement, 'var(--md-sys-color-secondary-container)'),
		)
		await expect(chip.querySelector('svg-icon.chip-icon')).not.toBeNull()
		await expect(
			chipOf(canvasElement, 'YOASOBI').querySelector('svg-icon.chip-icon'),
		).toBeNull()

		await dismiss(canvasElement)
	},
} satisfies Story

/** Tapping a chip puts a leading check and the secondary-container fill on it. */
export const ChipSelectedState = {
	render: render(),
	play: async ({ canvasElement }) => {
		await openFilter(canvasElement)
		const chip = chipOf(canvasElement, 'YOASOBI')
		await expect(chip.querySelector('svg-icon.chip-icon')).toBeNull()
		await expect(getComputedStyle(chip).backgroundColor).toBe(
			'rgba(0, 0, 0, 0)',
		)

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Chip selected state"
		await userEvent.click(chip)
		await userEvent.unhover(chip)
		const container = resolveColor(
			canvasElement,
			'var(--md-sys-color-secondary-container)',
		)
		await waitFor(() =>
			expect(getComputedStyle(chip).backgroundColor).toBe(container),
		)
		// The check is the leading icon, before the count and the name.
		const check = chip.querySelector('svg-icon.chip-icon') as HTMLElement
		await expect(check).not.toBeNull()
		await expect(
			chip.querySelector('.artist-count')?.compareDocumentPosition(check),
		).toBe(Node.DOCUMENT_POSITION_PRECEDING)
		await expect(check.getBoundingClientRect().right).toBeLessThanOrEqual(
			(
				chip.querySelector('.artist-count') as HTMLElement
			).getBoundingClientRect().left,
		)

		await dismiss(canvasElement)
	},
} satisfies Story

/**
 * 全て解除 is disabled while nothing is selected, enabled once a chip in any
 * facet is, and clears every facet without applying anything.
 */
export const ClearAll = {
	render: render(),
	args: { isAuthenticated: true },
	play: async ({ canvasElement }) => {
		await openFilter(canvasElement)
		const clear = within(canvasElement).getByRole('button', {
			name: '全て解除',
		})

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Clear all button disabled when nothing selected"
		await expect(checkedIds(canvasElement)).toEqual([])
		await expect(
			canvasElement.querySelectorAll('.journey-list input:checked'),
		).toHaveLength(0)
		await expect(clear).toBeDisabled()

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Clear all pending selections"
		await userEvent.click(chipOf(canvasElement, 'YOASOBI'))
		await expect(clear).toBeEnabled()
		await userEvent.click(
			canvasElement.querySelector('.journey-chip') as HTMLElement,
		)
		await userEvent.click(chipOf(canvasElement, 'Ado'))
		await expect(checkedIds(canvasElement)).toEqual(['3YOASOBI', '1Ado'])
		await expect(
			canvasElement.querySelectorAll('.journey-list input:checked'),
		).toHaveLength(1)

		await userEvent.click(clear)
		await expect(checkedIds(canvasElement)).toEqual([])
		await expect(
			canvasElement.querySelectorAll('.journey-list input:checked'),
		).toHaveLength(0)
		await expect(clear).toBeDisabled()
		// Nothing is applied until the confirm button is pressed.
		await expect(committed(canvasElement)).toBe('')
		await expect(committed(canvasElement, 'committed-statuses')).toBe('')

		await dismiss(canvasElement)
	},
} satisfies Story

/** Confirming commits the selected artists and closes the sheet. */
export const ConfirmSelection = {
	render: render(),
	play: async ({ canvasElement }) => {
		const dialog = await openFilter(canvasElement)
		await userEvent.click(chipOf(canvasElement, 'YOASOBI'))
		await userEvent.click(chipOf(canvasElement, 'Ado'))
		await expect(committed(canvasElement)).toBe('')

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Confirming selection"
		await userEvent.click(
			within(canvasElement).getByRole('button', { name: '完了' }),
		)
		await expect(committed(canvasElement)).toBe('a1,a3')
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
	},
} satisfies Story

/**
 * Deselecting every chip, or tapping 全て解除, and confirming clears the
 * filter: the committed selection is empty.
 */
export const ConfirmEmptySelection = {
	render: render(['a1', 'a2']),
	play: async ({ canvasElement }) => {
		const confirm = () =>
			userEvent.click(
				within(canvasElement).getByRole('button', { name: '完了' }),
			)
		const dialog = await openFilter(canvasElement)
		await expect(committed(canvasElement)).toBe('a1,a2')

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Confirming empty selection"
		// By deselecting each chip.
		await userEvent.click(chipOf(canvasElement, 'YOASOBI'))
		await userEvent.click(chipOf(canvasElement, 'Vaundy'))
		await confirm()
		await expect(committed(canvasElement)).toBe('')
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})

		// By 全て解除, from a filter that is active again.
		await openFilter(canvasElement)
		await userEvent.click(chipOf(canvasElement, 'Ado'))
		await confirm()
		await expect(committed(canvasElement)).toBe('a3')
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
		await openFilter(canvasElement)
		await userEvent.click(
			within(canvasElement).getByRole('button', { name: '全て解除' }),
		)
		await confirm()
		await expect(committed(canvasElement)).toBe('')
		await waitFor(() => expect(dialog.matches(':popover-open')).toBe(false), {
			timeout: 3000,
		})
	},
} satisfies Story

/**
 * The sheet rests flush on the bottom of the window, its body the scroll
 * snap target at the end, and the scroll container is exactly the dismiss
 * zone and the body tall: no fieldset or legend skews the height it reports.
 */
export const SnapsFlushToBottom = {
	render: render(),
	args: { isAuthenticated: true },
	play: async ({ canvasElement }) => {
		await openFilter(canvasElement)
		const body = canvasElement.querySelector('.sheet-body') as HTMLElement
		const area = canvasElement.querySelector('.scroll-area') as HTMLElement
		const zone = canvasElement.querySelector('.dismiss-zone') as HTMLElement

		// @spec components/infrastructure/fan/web/global/bottom-sheet "Sheet snaps flush to viewport bottom"
		await expect(getComputedStyle(body).scrollSnapAlign).toBe('end')
		await expect(
			Math.abs(body.getBoundingClientRect().bottom - innerHeight),
		).toBeLessThan(1)
		await expect(area.scrollTop).toBeCloseTo(
			area.scrollHeight - area.clientHeight,
			0,
		)
		await expect(body.querySelector('fieldset, legend')).toBeNull()
		await expect(area.scrollHeight).toBeCloseTo(
			zone.offsetHeight + body.offsetHeight,
			0,
		)

		await dismiss(canvasElement)
	},
} satisfies Story
