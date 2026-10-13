import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { consoleStoryParameters } from '../story-support'
import { StatTile } from './stat-tile'

const meta = {
	title: 'Console/StatTile',
	component: StatTile,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		label: { control: 'text' },
		value: { control: 'text' },
		supporting: { control: 'text' },
	},
	args: { label: '応募数', value: '412', supporting: '' },
} satisfies Meta<typeof StatTile>

export default meta
type Story = StoryObj<typeof meta>

export const Default = {
	render: (args) =>
		defineAureliaStory({
			template: `<div style="padding:16px; background:var(--md-color-surface)"><stat-tile label.bind="label" value.bind="value" supporting.bind="supporting"></stat-tile></div>`,
			props: args,
		}),
} satisfies Story

export const WithSupportingText = {
	args: { label: '申込枚数', value: '1,380', supporting: '販売枚数 800' },
	render: Default.render,
} satisfies Story

/** Two tiles in a column: the digits share widths and line up at the end. */
export const CountsLineUp = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:grid; justify-items:end; gap:8px; inline-size:240px; padding:16px; background:var(--md-color-surface)">
					<stat-tile label="応募数" value.bind="count | count" style="justify-self:stretch" data-testid="a"></stat-tile>
					<stat-tile label="申込枚数" value.bind="requested | count" style="justify-self:stretch" data-testid="b"></stat-tile>
				</div>
			`,
			props: { count: 412, requested: 1380 },
		}),
	play: async ({ canvasElement }) => {
		const values = [...canvasElement.querySelectorAll<HTMLElement>('.value')]
		await expect(values.map((v) => v.textContent?.trim())).toEqual([
			'412',
			'1,380',
		])
		for (const value of values) {
			await expect(getComputedStyle(value).fontVariantNumeric).toContain(
				'tabular-nums',
			)
		}
	},
} satisfies Story
