import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { consoleStoryParameters } from '../story-support'
import { PrerequisiteCallout } from './prerequisite-callout'

const meta = {
	title: 'Console/PrerequisiteCallout',
	component: PrerequisiteCallout,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		heading: { control: 'text' },
		actionLabel: { control: 'text' },
		actionHref: { control: 'text' },
	},
	args: {
		heading: '事業者情報が未登録です',
		actionLabel: '設定を開く',
		actionHref: '#settings',
	},
} satisfies Meta<typeof PrerequisiteCallout>

export default meta
type Story = StoryObj<typeof meta>

export const WithAction = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)">
					<prerequisite-callout heading.bind="heading" action-label.bind="actionLabel" action-href.bind="actionHref">
						販売を始めるには、特定商取引法に基づく表記に使う事業者情報が必要です。
					</prerequisite-callout>
				</div>
			`,
			props: args,
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByRole('region', { name: '事業者情報が未登録です' }),
		).toBeVisible()
		await expect(
			canvas.getByRole('link', { name: '設定を開く' }),
		).toHaveAttribute('href', '#settings')
	},
} satisfies Story

export const WithoutAction = {
	args: { heading: '開演時刻が未設定です', actionHref: '' },
	render: WithAction.render,
} satisfies Story
