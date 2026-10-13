import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { userEvent } from 'vitest/browser'
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
		level: {
			control: 'inline-radio',
			options: [2, 3],
			description: 'The heading level: 2 under the page title, 3 in a section.',
		},
	},
	args: {
		heading: '事業者情報が未登録です',
		actionLabel: '設定を開く',
		actionHref: '#settings',
		level: 3,
	},
} satisfies Meta<typeof PrerequisiteCallout>

export default meta
type Story = StoryObj<typeof meta>

export const WithAction = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)">
					<prerequisite-callout heading.bind="heading" action-label.bind="actionLabel" action-href.bind="actionHref" level.bind="level">
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
			canvas
				.getByRole('heading', { level: 3, name: '事業者情報が未登録です' })
				.element(),
		).toBeVisible()
		const link = canvas.getByRole('link', { name: '設定を開く' }).element()
		await expect(link).toHaveAttribute('href', '#settings')
		// The fix reads in the callout's text color, not the brand color.
		await expect(getComputedStyle(link).color).toBe(
			getComputedStyle(canvas.getByRole('heading', { level: 3 }).element())
				.color,
		)
	},
} satisfies Story

export const WithoutAction = {
	args: { heading: '開演時刻が未設定です', actionHref: '' },
	render: WithAction.render,
} satisfies Story

/** Directly under the page title (the Sales tab, a sale editor): an h2. */
export const UnderThePageTitle = {
	args: {
		heading: '販売を始めるには、公演を公開してください',
		actionHref: '',
		level: 2,
	},
	render: WithAction.render,
	play: async ({ canvasElement }) => {
		await expect(
			canvasOf(canvasElement)
				.getByRole('heading', {
					level: 2,
					name: '販売を始めるには、公演を公開してください',
				})
				.element(),
		).toBeVisible()
	},
} satisfies Story

/**
 * A fix that is an action, not a page (公開する on the Sales tab): a button
 * whose press the screen hears as the callout's `action` event. Like the
 * link, it reads in the callout's text color, not the brand color.
 */
export const ButtonAction = {
	args: {
		heading: '販売を始めるには、公演を公開してください',
		actionLabel: '公開する',
		actionHref: '',
		level: 2,
	},
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:390px; padding:16px; background:var(--md-color-surface)">
					<prerequisite-callout heading.bind="heading" action-label.bind="actionLabel" action-href.bind="actionHref" level.bind="level" action.trigger="pressed = pressed + 1">
						公開すると、チケットの販売を始められます。
					</prerequisite-callout>
					<output data-testid="pressed">\${pressed}</output>
				</div>
			`,
			props: { ...args, pressed: 0 },
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		const button = canvas.getByRole('button', { name: '公開する' })
		await expect(canvas.getByRole('link').elements()).toHaveLength(0)
		const element = button.element()
		const heading = canvas.getByRole('heading', { level: 2 }).element()
		await expect(getComputedStyle(element).color).toBe(
			getComputedStyle(heading).color,
		)
		await userEvent.click(button)
		await expect(canvas.getByTestId('pressed').element()).toHaveTextContent('1')
	},
} satisfies Story
