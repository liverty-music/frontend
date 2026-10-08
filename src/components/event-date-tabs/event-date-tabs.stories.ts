import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { expect as vitestExpect } from 'vitest'
import { type EventDateTab, EventDateTabs } from './event-date-tabs'

const meta = {
	title: 'Components/EventDateTabs',
	component: EventDateTabs,
	tags: ['test', 'autodocs'],
	argTypes: {
		label: { control: 'text', description: 'Accessible name of the tabs.' },
	},
} satisfies Meta<typeof EventDateTabs>

export default meta
type Story = StoryObj<typeof meta>

function tabs(labels: string[], selected: number): EventDateTab[] {
	return labels.map((label, i) => ({
		id: `ev-${i + 1}`,
		label,
		selected: i === selected,
	}))
}

// Rendered in a 360px-wide frame: the narrowest supported phone viewport.
function story(items: EventDateTab[]) {
	return defineAureliaStory({
		template: `<div class="frame-360" style="inline-size: 360px">
			<event-date-tabs tabs.bind="tabs" label="Dates"></event-date-tabs>
		</div>`,
		props: { tabs: items },
		register: [EventDateTabs],
	})
}

/** A two-day run with the first day displayed. */
export const TwoDays = {
	render: () => story(tabs(['11/20(金)', '11/21(土)'], 0)),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const links = canvas.getAllByRole('link')
		await expect(links).toHaveLength(2)
		await expect(links[0]).toHaveAttribute('aria-current', 'page')
		await expect(links[1]).toHaveAttribute('href', '/events/ev-2')
	},
} satisfies Story

/** Four dates, the most shown as tabs, at 360px. */
export const FourDates = {
	render: () =>
		story(tabs(['11/20(金)', '11/21(土)', '11/27(金)', '11/28(土)'], 2)),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		const links = canvas.getAllByRole('link')
		await expect(links).toHaveLength(4)
		// Every tab keeps the 44px tap target and fits the 360px frame.
		for (const link of links) {
			await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(
				44,
			)
		}
		const frame = canvasElement.querySelector('.frame-360') as HTMLElement
		await expect(frame.scrollWidth).toBeLessThanOrEqual(360)
		await vitestExpect
			.element(frame)
			.toMatchScreenshot('event-date-tabs-four-360', {
				comparatorName: 'pixelmatch',
				comparatorOptions: { allowedMismatchedPixelRatio: 0.001 },
			})
	},
} satisfies Story
