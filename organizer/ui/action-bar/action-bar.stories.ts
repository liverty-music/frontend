import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { consoleStoryParameters } from '../story-support'
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
		const scroller = within(canvasElement).getByTestId('scroller')
		const bar = canvasElement.querySelector('action-bar') as HTMLElement
		// Before scrolling, the bar is pinned to the bottom of the scroll area.
		await expect(bar.getBoundingClientRect().bottom).toBeCloseTo(
			scroller.getBoundingClientRect().bottom,
			0,
		)
	},
} satisfies Story
