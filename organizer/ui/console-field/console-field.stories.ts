import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { userEvent } from 'vitest/browser'
import {
	canvasOf,
	consoleStoryParameters,
	contrastRatio,
	deepQuery,
	deepQueryAll,
} from '../story-support'
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
		const input = canvasOf(canvasElement)
			.getByRole('textbox', { name: /販売名/ })
			.element()
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
		await expect(
			canvasOf(canvasElement).getByText('JST').element(),
		).toBeVisible()
	},
} satisfies Story

export const Yen = {
	render,
	args: { type: 'yen', label: '価格', value: '6500' },
	play: async ({ canvasElement }) => {
		await expect(
			canvasOf(canvasElement).getByText('円').element(),
		).toBeVisible()
	},
} satisfies Story

const VERIFICATION = [
	{ value: '0', label: '本人確認なし' },
	{ value: '1', label: '本人確認済み' },
	{ value: '2', label: 'マイナンバーカードで本人確認済み' },
]

/** A select in a container whose color scheme is `scheme`. */
const renderSelect =
	(scheme: 'light' | 'dark'): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<div style="color-scheme:${scheme}; inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-field type="select" label="本人確認" value.bind="value" options.bind="options"></console-field>
				</div>
			`,
			props: { ...args, value: '0', options: VERIFICATION },
		})

/**
 * Opens the picker and checks every option, the chosen one and the one under
 * the pointer against the picker: each reads at 4.5:1 or more.
 */
async function checkOpenPicker(canvasElement: HTMLElement): Promise<void> {
	const select = deepQuery<HTMLSelectElement>(canvasElement, 'select')
	await userEvent.click(select)
	await waitFor(() => expect(select.matches(':open')).toBe(true))

	const options = deepQueryAll<HTMLOptionElement>(canvasElement, 'option')
	await expect(options.map((o) => o.textContent?.trim())).toEqual(
		VERIFICATION.map((o) => o.label),
	)
	await userEvent.hover(options[2])
	for (const option of options) {
		const style = getComputedStyle(option)
		await expect(
			contrastRatio(style.color, style.backgroundColor),
		).toBeGreaterThanOrEqual(4.5)
	}
	// The options sit on the console's surface container, not the browser's
	// own list: an option neither chosen nor hovered has its color.
	const probe = document.createElement('span')
	probe.style.background = 'var(--md-color-surface-container)'
	canvasElement.firstElementChild?.append(probe)
	await expect(getComputedStyle(options[1]).backgroundColor).toBe(
		getComputedStyle(probe).backgroundColor,
	)
	probe.remove()
	await expect(options[0].selected).toBe(true)
}

export const Select = {
	render: renderSelect('light'),
	play: async ({ canvasElement }) => {
		await checkOpenPicker(canvasElement)
	},
} satisfies Story

export const SelectInDarkMode = {
	render: renderSelect('dark'),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/design-tokens "Open selection list in dark mode"
		await checkOpenPicker(canvasElement)
	},
} satisfies Story

/** The screen hears a committed choice through the field's own `change`. */
export const SelectChange = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-field type="select" label="本人確認" value.to-view="value" options.bind="options" change.trigger="chosen = $event.detail.value"></console-field>
					<output data-testid="chosen">\${chosen}</output>
				</div>
			`,
			props: { ...args, value: '0', chosen: 'none', options: VERIFICATION },
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await userEvent.selectOptions(
			canvas.getByRole('combobox', { name: '本人確認' }),
			'2',
		)
		await waitFor(() =>
			expect(canvas.getByTestId('chosen').element()).toHaveTextContent('2'),
		)
	},
} satisfies Story

export const Textarea = {
	render,
	args: { type: 'textarea', label: '説明' },
} satisfies Story

export const Disabled = {
	render,
	args: { disabled: true, value: '変更できません' },
} satisfies Story
