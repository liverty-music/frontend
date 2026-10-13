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
import { ConsoleTimeField } from './console-time-field'
import { HOURS, MINUTES } from './time-of-day'

const meta = {
	title: 'Console/ConsoleTimeField',
	component: ConsoleTimeField,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		label: { control: 'text' },
		value: { control: 'text', description: '`HH:mm`, or empty.' },
		error: { control: 'text', description: 'Catalog key of the error.' },
		hint: { control: 'text' },
		required: { control: 'boolean' },
		disabled: { control: 'boolean' },
		readonly: { control: 'boolean' },
	},
	args: {
		label: '開演',
		value: '',
		error: '',
		hint: '',
		required: false,
		disabled: false,
		readonly: false,
	},
} satisfies Meta<typeof ConsoleTimeField>

export default meta
type Story = StoryObj<typeof meta>

const render: Story['render'] = (args) =>
	defineAureliaStory({
		template: `
			<div style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
				<console-time-field
					label.bind="label" value.bind="value" error.bind="error" hint.bind="hint"
					required.bind="required" disabled.bind="disabled" readonly.bind="readonly"
				></console-time-field>
			</div>
		`,
		props: { ...args },
	})

/** Option texts of the select named `name`. */
function optionTexts(canvasElement: HTMLElement, name: string): string[] {
	const select = canvasOf(canvasElement)
		.getByRole('combobox', { name })
		.element() as HTMLSelectElement
	return [...select.options].map((o) => o.text.trim())
}

export const Empty = {
	render,
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		// One group named by the label, a select for each part.
		await expect(
			canvas.getByRole('group', { name: '開演' }).element(),
		).toBeVisible()
		const hour = canvas
			.getByRole('combobox', { name: '時' })
			.element() as HTMLSelectElement
		const minute = canvas
			.getByRole('combobox', { name: '分' })
			.element() as HTMLSelectElement
		await expect(hour.value).toBe('')
		await expect(minute.value).toBe('')
		await expect(hour).toHaveAccessibleDescription('JST')
		await expect(canvas.getByText('JST').element()).toBeVisible()
	},
} satisfies Story

export const WithValue = {
	render,
	args: { value: '19:00', hint: '公演ページに表示されます' },
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await expect(
			canvas.getByRole('combobox', { name: '時' }).element(),
		).toHaveValue('19')
		await expect(
			canvas.getByRole('combobox', { name: '分' }).element(),
		).toHaveValue('00')
	},
} satisfies Story

export const RequiredWithError = {
	render,
	args: { required: true, error: 'common.required' },
	play: async ({ canvasElement }) => {
		const hour = canvasOf(canvasElement)
			.getByRole('combobox', { name: '時' })
			.element()
		await expect(hour).toBeRequired()
		await expect(hour).toHaveAttribute('aria-invalid', 'true')
		await expect(hour).toHaveAccessibleDescription('JST 必須')
	},
} satisfies Story

export const Disabled = {
	render,
	args: { value: '18:30', disabled: true },
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await expect(
			canvas.getByRole('combobox', { name: '時' }).element(),
		).toBeDisabled()
		await expect(
			canvas.getByRole('combobox', { name: '分' }).element(),
		).toBeDisabled()
	},
} satisfies Story

/** A fixed time (a published date): readable at full contrast, not editable. */
export const ReadOnly = {
	render,
	args: { value: '18:30', readonly: true },
	play: async ({ canvasElement }) => {
		const input = canvasOf(canvasElement)
			.getByRole('textbox', { name: '開演' })
			.element()
		await expect(input).toHaveValue('18:30')
		await expect(input).toHaveAttribute('readonly')
		await expect(input).not.toBeDisabled()
		await expect(input).toHaveAccessibleDescription('JST')
	},
} satisfies Story

/** A minute saved off the 5-minute steps is shown and kept, never rounded. */
export const OffStepMinuteKept = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-time-field label="開演" value.bind="value"></console-time-field>
					<output data-testid="value">\${value}</output>
				</div>
			`,
			props: { ...args, value: '18:07' },
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await expect(
			canvas.getByRole('combobox', { name: '分' }).element(),
		).toHaveValue('07')
		await expect(optionTexts(canvasElement, '分')).toEqual(
			['--', ...MINUTES, '07'].sort(),
		)
		await expect(canvas.getByTestId('value').element()).toHaveTextContent(
			'18:07',
		)
		// Changing only the hour keeps the saved minute.
		await userEvent.selectOptions(
			canvas.getByRole('combobox', { name: '時' }),
			'19',
		)
		await waitFor(() =>
			expect(canvas.getByTestId('value').element()).toHaveTextContent('19:07'),
		)
	},
} satisfies Story

/** The screen hears each committed change through the field's own `change`. */
export const ChoosingEmitsChange = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-time-field label="開場" value.to-view="value" change.trigger="chosen = $event.detail.value"></console-time-field>
					<output data-testid="chosen">\${chosen}</output>
				</div>
			`,
			props: { ...args, value: '', chosen: 'none' },
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		await userEvent.selectOptions(
			canvas.getByRole('combobox', { name: '時' }),
			'17',
		)
		// An hour alone is that hour on the dot.
		await waitFor(() =>
			expect(canvas.getByTestId('chosen').element()).toHaveTextContent('17:00'),
		)
		await userEvent.selectOptions(
			canvas.getByRole('combobox', { name: '分' }),
			'30',
		)
		await waitFor(() =>
			expect(canvas.getByTestId('chosen').element()).toHaveTextContent('17:30'),
		)
	},
} satisfies Story

/**
 * A device on a 12-hour clock, in English (the page language is `en-US`, whose
 * clock says 6:00 PM): the field still offers 00 to 23 and no AM or PM.
 */
export const TwelveHourDevice = {
	render: (args) =>
		defineAureliaStory({
			template: `
				<div lang="en-US" style="inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-time-field label="Doors" value.bind="value"></console-time-field>
				</div>
			`,
			props: { ...args, value: '18:00' },
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/i18n "Device on a 12-hour clock"
		// The locale of this story does format 18:00 as 6:00 PM ...
		await expect(
			new Intl.DateTimeFormat('en-US', {
				hour: 'numeric',
				minute: '2-digit',
			}).format(new Date(2026, 10, 3, 18)),
		).toMatch(/PM/)
		// ... and the field offers 00 to 23, minutes in 5-minute steps.
		await expect(optionTexts(canvasElement, '時')).toEqual(['--', ...HOURS])
		await expect(optionTexts(canvasElement, '分')).toEqual(['--', ...MINUTES])
		await expect(
			canvasOf(canvasElement).getByRole('combobox', { name: '時' }).element(),
		).toHaveValue('18')
		const text = deepQueryAll(canvasElement, 'fieldset')
			.map((f) => f.textContent ?? '')
			.join(' ')
		await expect(text).not.toMatch(/AM|PM|午前|午後/i)
	},
} satisfies Story

/** The time field in a container whose color scheme is `scheme`. */
const renderPicker =
	(scheme: 'light' | 'dark'): Story['render'] =>
	(args) =>
		defineAureliaStory({
			template: `
				<div style="color-scheme:${scheme}; inline-size:360px; padding:16px; background:var(--md-color-surface)">
					<console-time-field label="開演" value.bind="value" required.bind="true"></console-time-field>
				</div>
			`,
			props: { ...args, value: '19:00' },
		})

/**
 * Opens the hour picker and checks every option, the chosen one and the one
 * under the pointer against the picker: each reads at 4.5:1 or more.
 */
async function checkOpenPicker(canvasElement: HTMLElement): Promise<void> {
	const select = deepQuery<HTMLSelectElement>(canvasElement, 'select')
	await userEvent.click(select)
	await waitFor(() => expect(select.matches(':open')).toBe(true))

	const options = [...select.options]
	await expect(options.map((o) => o.text.trim())).toEqual([...HOURS])
	await userEvent.hover(options[18])
	for (const option of options) {
		const style = getComputedStyle(option)
		await expect(
			contrastRatio(style.color, style.backgroundColor),
		).toBeGreaterThanOrEqual(4.5)
	}
	const probe = document.createElement('span')
	probe.style.background = 'var(--md-color-surface-container)'
	canvasElement.firstElementChild?.append(probe)
	await expect(getComputedStyle(options[1]).backgroundColor).toBe(
		getComputedStyle(probe).backgroundColor,
	)
	probe.remove()
	await expect(options[19].selected).toBe(true)
	await userEvent.keyboard('{Escape}')
}

export const Picker = {
	render: renderPicker('light'),
	play: async ({ canvasElement }) => {
		await checkOpenPicker(canvasElement)
	},
} satisfies Story

export const PickerInDarkMode = {
	render: renderPicker('dark'),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/design-tokens "Open selection list in dark mode"
		await checkOpenPicker(canvasElement)
	},
} satisfies Story
