import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent } from 'storybook/test'
import { FilterDateFacet } from './filter-date-facet'

const meta = {
	title: 'Components/FilterDateFacet',
	component: FilterDateFacet,
	argTypes: {
		from: { control: 'text' },
		expanded: { control: 'boolean' },
	},
} satisfies Meta<typeof FilterDateFacet>

export default meta
type Story = StoryObj<typeof meta>

/** The facet in the filter sheet's stacked <section>, as artist-filter-bar places it. */
function render(args: { from?: string; expanded?: boolean }) {
	return defineAureliaStory({
		template: `<section class="stack" style="inline-size: 343px" aria-labelledby="filter-date-heading">
			<filter-date-facet from.bind="from" expanded.bind="expanded"></filter-date-facet>
		</section>`,
		props: args,
		register: [FilterDateFacet],
	})
}

/** Collapsed: only the toggle, so the timetable stays today-onward. */
export const Collapsed = {
	args: { from: '2026-11-11', expanded: false },
	render,
	play: async ({ canvasElement }) => {
		const toggle = canvasElement.querySelector<HTMLButtonElement>(
			'button.date-facet-toggle',
		)
		if (!toggle) throw new Error('no toggle')
		await expect(toggle.getAttribute('aria-expanded')).toBe('false')
		await expect(canvasElement.querySelector('#filter-from-input')).toBeNull()

		// Tapping the toggle reveals the date field.
		await userEvent.click(toggle)
		await expect(toggle.getAttribute('aria-expanded')).toBe('true')
		await expect(
			canvasElement.querySelector('input#filter-from-input[type="date"]'),
		).not.toBeNull()
	},
} satisfies Story

/** Expanded: the field shows the pending date and the caret turns down. */
export const Expanded = {
	args: { from: '2020-01-01', expanded: true },
	render,
	play: async ({ canvasElement }) => {
		const input = canvasElement.querySelector<HTMLInputElement>(
			'input#filter-from-input',
		)
		const caret = canvasElement.querySelector<HTMLElement>('.date-facet-caret')
		if (!input || !caret) throw new Error('no date field')
		await expect(input.value).toBe('2020-01-01')
		await expect(caret.dataset.expanded).toBe('true')
	},
} satisfies Story
