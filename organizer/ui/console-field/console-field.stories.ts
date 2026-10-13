import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, within } from 'storybook/test'
import { consoleStoryParameters } from '../story-support'
import { ConsoleField } from './console-field'

const meta = {
	title: 'Console/ConsoleField',
	component: ConsoleField,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		type: {
			control: 'select',
			options: [
				'text',
				'textarea',
				'number',
				'select',
				'datetime-local',
				'date',
				'time',
				'yen',
			],
		},
		label: { control: 'text' },
		value: { control: 'text' },
		error: { control: 'text' },
		hint: { control: 'text' },
		required: { control: 'boolean' },
		disabled: { control: 'boolean' },
	},
	args: {
		type: 'text',
		label: '公演名',
		value: '',
		error: '',
		hint: '',
		required: false,
		disabled: false,
	},
} satisfies Meta<typeof ConsoleField>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
				<console-field
					type.bind="type" label.bind="label" value.bind="value" error.bind="error"
					hint.bind="hint" required.bind="required" disabled.bind="disabled" options.bind="options"
				></console-field>
			</div>
		`,
		props: { options: [], ...args },
	})

export const Text = {
	render,
	args: { hint: '公演ページに表示されます' },
} satisfies Story

export const Required = { render, args: { required: true } } satisfies Story

export const FieldError = {
	render,
	args: { label: '販売名', required: true, error: '販売名を入力してください' },
	play: async ({ canvasElement }) => {
		const input = within(canvasElement).getByRole('textbox', { name: /販売名/ })
		await expect(input).toHaveAttribute('aria-invalid', 'true')
		await expect(input).toHaveAccessibleDescription('販売名を入力してください')
	},
} satisfies Story

export const DateTimeInJapanTime = {
	render,
	args: {
		type: 'datetime-local',
		label: '販売開始',
		value: '2026-10-10T12:00',
	},
	play: async ({ canvasElement }) => {
		// The field says JST next to it.
		await expect(within(canvasElement).getByText('JST')).toBeVisible()
	},
} satisfies Story

export const Yen = {
	render,
	args: { type: 'yen', label: '価格', value: '6500' },
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).getByText('円')).toBeVisible()
	},
} satisfies Story

export const Select = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-field type="select" label="本人確認" value.bind="value" options.bind="options"></console-field>
				</div>
			`,
			props: {
				...args,
				value: 'none',
				options: [
					{ value: 'none', label: '不要' },
					{ value: 'required', label: '必須' },
				],
			},
		}),
} satisfies Story

export const Textarea = {
	render,
	args: { type: 'textarea', label: '説明' },
} satisfies Story

export const Disabled = {
	render,
	args: { disabled: true, value: '変更できません' },
} satisfies Story
