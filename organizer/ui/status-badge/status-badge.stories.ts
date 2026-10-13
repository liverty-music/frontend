import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { canvasOf, consoleStoryParameters } from '../story-support'
import { StatusBadge } from './status-badge'

const meta = {
	title: 'Console/StatusBadge',
	component: StatusBadge,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		tone: {
			control: 'select',
			options: ['success', 'warning', 'error', 'neutral', 'info'],
		},
		label: { control: 'text' },
	},
	args: { tone: 'success', label: '公開中' },
} satisfies Meta<typeof StatusBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Tones = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-wrap:wrap; gap:8px; padding:16px; background:var(--md-color-surface)">
					<status-badge tone="success" label="公開中"></status-badge>
					<status-badge tone="neutral" label="下書き"></status-badge>
					<status-badge tone="warning" label="受付前"></status-badge>
					<status-badge tone="error" label="中止"></status-badge>
					<status-badge tone="info" label="抽選済み"></status-badge>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		// Every status carries its text: color is never the only signal.
		for (const label of ['公開中', '下書き', '受付前', '中止', '抽選済み']) {
			await expect(
				canvasOf(canvasElement).getByText(label).element(),
			).toBeVisible()
		}
	},
} satisfies Story

export const Published = {
	render: (args) =>
		defineAureliaStory({
			template: `<div style="padding:16px; background:var(--md-color-surface)"><status-badge tone.bind="tone" label.bind="label"></status-badge></div>`,
			props: args,
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/design-tokens "Status with label"
		const badge = canvasOf(canvasElement).getByText('公開中').element()
		const color = getComputedStyle(badge).backgroundColor
		await expect(color).not.toBe('rgba(0, 0, 0, 0)')
		await expect(badge).toBeVisible()
	},
} satisfies Story
