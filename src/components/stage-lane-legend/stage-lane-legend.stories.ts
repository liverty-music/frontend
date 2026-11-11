import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { StageLaneLegend } from './stage-lane-legend'

const meta = {
	title: 'Components/StageLaneLegend',
	component: StageLaneLegend,
} satisfies Meta<typeof StageLaneLegend>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The Dashboard help's lane legend, on the `<dl>` it renders on: each lane's
 * label in its lane colour, the descriptions in one column.
 */
export const Default = {
	render: () =>
		defineAureliaStory({
			template:
				'<dl as-element="stage-lane-legend" class="page-help-lanes" style="inline-size: 343px; background: var(--md-sys-color-surface-container)"></dl>',
			register: [StageLaneLegend],
		}),
	play: async ({ canvasElement }) => {
		const terms = [...canvasElement.querySelectorAll<HTMLElement>('dt')]
		await expect(terms).toHaveLength(3)
		// The descriptions start at one x, whatever the label widths.
		const starts = [...canvasElement.querySelectorAll('dd')].map(
			(dd) => dd.getBoundingClientRect().left,
		)
		await expect(new Set(starts).size).toBe(1)
	},
} satisfies Story
