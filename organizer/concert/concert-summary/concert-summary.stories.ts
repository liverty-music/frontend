import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { consoleStoryParameters } from '../../ui/story-support'
import { ConcertSummary } from './concert-summary'

/** A square cover, drawn inline so the story needs no network. */
const COVER =
	'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"%3E%3Crect width="1" height="1" fill="%23808080"/%3E%3C/svg%3E'

const meta = {
	title: 'Console/ConcertSummary',
	component: ConcertSummary,
	parameters: consoleStoryParameters,
	argTypes: {
		coverUrl: { control: 'text' },
		coverNote: { control: 'select', options: ['', 'processing', 'slow'] },
		typeKey: {
			control: 'select',
			options: ['seriesType.single', 'seriesType.tour', 'seriesType.festival'],
		},
		visibilityKey: {
			control: 'select',
			options: ['visibility.public', 'visibility.unlisted'],
		},
		performers: { control: 'object' },
	},
	args: {
		coverUrl: '',
		coverNote: '',
		typeKey: 'seriesType.tour',
		visibilityKey: 'visibility.public',
		performers: ['Band A', 'Band B'],
	},
} satisfies Meta<typeof ConcertSummary>

export default meta
type Story = StoryObj<typeof meta>

/** The window width the page's container query reads (`shell`). */
const render =
	(windowWidth: number): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<div style="container: shell / inline-size; inline-size:${windowWidth}px; padding:16px; background:var(--md-sys-color-surface)">
					<concert-summary
						cover-url.bind="coverUrl"
						cover-note.bind="coverNote"
						type-key.bind="typeKey"
						visibility-key.bind="visibilityKey"
						performers.bind="performers"
					></concert-summary>
				</div>
			`,
			props: args,
			register: [ConcertSummary],
		})

const paneOf = (canvasElement: HTMLElement): HTMLElement => {
	const pane = canvasElement.querySelector<HTMLElement>('.supporting')
	if (!pane) throw new Error('summary pane not rendered')
	return pane
}

/** Below 840 px: no cover, the type, visibility and performers, unfilled. */
export const Compact = {
	render: render(400),
	play: async ({ canvasElement }) => {
		const pane = paneOf(canvasElement)
		await expect(pane.querySelector('.cover')).toBeNull()
		await expect(pane.querySelectorAll('.summary-row')).toHaveLength(3)
		await expect(getComputedStyle(pane).backgroundColor).toBe(
			'rgba(0, 0, 0, 0)',
		)
	},
} satisfies Story

/** From 840 px: the pane is filled, as it sits beside the dates. */
export const Expanded = {
	render: render(900),
	play: async ({ canvasElement }) => {
		const pane = paneOf(canvasElement)
		await expect(getComputedStyle(pane).backgroundColor).not.toBe(
			'rgba(0, 0, 0, 0)',
		)
	},
} satisfies Story

/** A cover, at most 360 px square. */
export const WithCover = {
	args: { coverUrl: COVER },
	render: render(900),
	play: async ({ canvasElement }) => {
		const cover = paneOf(canvasElement).querySelector('.cover')
		await expect(cover).not.toBeNull()
	},
} satisfies Story

/** A picked cover still processed: the note under it. */
export const Processing = {
	args: { coverUrl: COVER, coverNote: 'processing' },
	render: render(400),
	play: async ({ canvasElement }) => {
		const note = paneOf(canvasElement).querySelector('[role="status"]')
		await expect(note?.textContent?.trim()).not.toBe('')
	},
} satisfies Story

/** No performer named: the performers row is left out. */
export const NoPerformers = {
	args: { performers: [] },
	render: render(400),
	play: async ({ canvasElement }) => {
		await expect(
			paneOf(canvasElement).querySelectorAll('.summary-row'),
		).toHaveLength(2)
	},
} satisfies Story
