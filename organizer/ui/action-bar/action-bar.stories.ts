import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import {
	canvasOf,
	consoleStoryParameters,
	contrastRatio,
	deepQuery,
} from '../story-support'
import { ActionBar } from './action-bar'

const meta = {
	title: 'Console/ActionBar',
	component: ActionBar,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
} satisfies Meta<typeof ActionBar>

export default meta
type Story = StoryObj<typeof meta>

export const StaysAtTheBottom = {
	parameters: {
		// axe-core misreads the background of a button slotted into a stuck
		// sticky bar inside a scroll container across shadow roots (it reports
		// the page surface behind the filled button). The play function checks
		// the contrast of both buttons itself instead.
		a11y: { options: { rules: { 'color-contrast': { enabled: false } } } },
	},
	render: () =>
		defineAureliaStory({
			template: `
				<div data-testid="scroller" style="block-size:300px; overflow:auto; background:var(--md-color-surface); color:var(--md-color-on-surface)">
					<div style="block-size:800px; padding:16px">フォーム</div>
					<action-bar>
						<console-button variant="text">やめる</console-button>
						<console-button variant="filled">保存する</console-button>
					</action-bar>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const scroller = canvas.getByTestId('scroller').element()
		const bar = deepQuery(canvasElement, '.action-bar')
		// The page's buttons show in the bar, readable on their containers.
		for (const name of ['やめる', '保存する']) {
			const button = canvas.getByRole('button', { name }).element()
			await expect(button).toBeVisible()
			const style = getComputedStyle(button)
			const background =
				style.backgroundColor === 'rgba(0, 0, 0, 0)'
					? getComputedStyle(bar).backgroundColor
					: style.backgroundColor
			await expect(
				contrastRatio(style.color, background),
			).toBeGreaterThanOrEqual(4.5)
		}
		// Before scrolling, the bar is pinned to the bottom of the scroll area.
		await expect(bar.getBoundingClientRect().bottom).toBeCloseTo(
			scroller.getBoundingClientRect().bottom,
			0,
		)
	},
} satisfies Story
