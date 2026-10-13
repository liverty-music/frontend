import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { canvasOf, consoleStoryParameters } from '../story-support'
import { DescriptionList } from './description-list'

const meta = {
	title: 'Console/DescriptionList',
	component: DescriptionList,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
} satisfies Meta<typeof DescriptionList>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `<div style="padding:16px; background:var(--md-color-surface)"><description-list items.bind="items" empty-label="未登録"></description-list></div>`,
		props: args,
	})

export const Complete = {
	args: {
		items: [
			{ term: '事業者名', value: '株式会社サンプル' },
			{ term: '所在地', value: '東京都渋谷区神南1-1-1' },
			{ term: '電話番号', value: '03-0000-0000' },
		],
	},
	render,
} satisfies Story

export const WithMissingValue = {
	args: {
		items: [
			{ term: '事業者名', value: '株式会社サンプル' },
			{ term: '所在地', value: '' },
		],
	},
	render,
	play: async ({ canvasElement }) => {
		await expect(
			canvasOf(canvasElement).getByText('未登録').element(),
		).toBeVisible()
	},
} satisfies Story
