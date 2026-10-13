import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { canvasOf, consoleStoryParameters } from '../story-support'
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
		level: { control: 'select', options: [2, 3] },
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
		const canvas = canvasOf(canvasElement)
		await expect(
			canvas.getByRole('region', { name: '事業者情報が未登録です' }).element(),
		).toBeVisible()
		await expect(
			canvas.getByRole('link', { name: '設定を開く' }).element(),
		).toHaveAttribute('href', '#settings')
	},
} satisfies Story

/** Directly under a page's title (an event's tab): a level-2 heading. */
export const UnderThePageTitle = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)">
					<prerequisite-callout heading="受付リンクを発行するには、公演を公開してください" level="2">
						公開していない公演日では受付リンクを発行できません。
					</prerequisite-callout>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		await expect(
			canvasOf(canvasElement)
				.getByRole('heading', {
					level: 2,
					name: '受付リンクを発行するには、公演を公開してください',
				})
				.element(),
		).toBeVisible()
	},
} satisfies Story

export const WithoutAction = {
	args: { heading: '開演時刻が未設定です', actionHref: '' },
	render: WithAction.render,
} satisfies Story
