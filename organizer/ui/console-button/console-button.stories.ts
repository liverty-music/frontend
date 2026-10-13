import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor, within } from 'storybook/test'
import { commands, userEvent } from 'vitest/browser'
import { consoleStoryParameters } from '../story-support'
import { ConsoleButton } from './console-button'

const meta = {
	title: 'Console/ConsoleButton',
	component: ConsoleButton,
	tags: ['test', 'autodocs'],
	parameters: consoleStoryParameters,
	argTypes: {
		variant: {
			control: 'select',
			options: ['filled', 'tonal', 'outlined', 'text', 'danger'],
			description: '`filled` is the page’s one primary action (brand color).',
		},
		icon: { control: 'text' },
		pendingLabel: { control: 'text' },
		disabled: { control: 'boolean' },
		pending: { control: 'boolean' },
		href: { control: 'text' },
	},
	args: {
		variant: 'filled',
		icon: '',
		pendingLabel: '',
		disabled: false,
		pending: false,
		href: '',
	},
} satisfies Meta<typeof ConsoleButton>

export default meta
type Story = StoryObj<typeof meta>

const surface =
	'display:flex; flex-wrap:wrap; gap:16px; padding:24px; background:var(--md-color-surface); color:var(--md-color-on-surface)'

/** Opacity of the state layer (`::before`) of the button inside `host`. */
function stateLayerOpacity(host: HTMLElement): number {
	const button = host.querySelector('button, a')
	if (!button) throw new Error('no button')
	return Number(getComputedStyle(button, '::before').opacity)
}

export const Variants = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="${surface}">
					<console-button variant="filled">公開する</console-button>
					<console-button variant="tonal">先着で販売する</console-button>
					<console-button variant="outlined">編集</console-button>
					<console-button variant="text">やめる</console-button>
					<console-button variant="danger">取り消す</console-button>
					<console-button variant="filled" icon="add">公演をつくる</console-button>
					<console-button variant="outlined" disabled.bind="true">保存する</console-button>
					<console-button variant="text" href="#concerts">公演一覧へ</console-button>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// The link variant is a link, every other one a button.
		await expect(canvas.getByRole('link', { name: '公演一覧へ' })).toBeVisible()
		await expect(
			canvas.getByRole('button', { name: '保存する' }),
		).toBeDisabled()
		// Every control answers taps on at least 48 × 48 px.
		for (const control of canvasElement.querySelectorAll('button, a')) {
			const box = control.getBoundingClientRect()
			const target = getComputedStyle(control, '::after')
			await expect(Number.parseFloat(target.blockSize)).toBeGreaterThanOrEqual(
				48,
			)
			await expect(
				Math.max(box.width, Number.parseFloat(target.inlineSize)),
			).toBeGreaterThanOrEqual(48)
		}
	},
} satisfies Story

export const Pending = {
	args: { pending: true, pendingLabel: '保存中…' },
	render: (args) =>
		defineAureliaStory({
			template: `
				<div style="${surface}">
					<console-button variant="filled" pending.bind="pending" pending-label.bind="pendingLabel">保存する</console-button>
				</div>
			`,
			props: args,
		}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		await expect(
			canvas.getByRole('progressbar', { name: '保存中…' }),
		).toBeVisible()
		await expect(
			canvas.getByText('保存中…', { selector: '.label' }),
		).toBeVisible()
	},
} satisfies Story

/** Resolves the save started by the story below; set while it is pending. */
let finishSave: (() => void) | null = null

/** The operator presses 保存する twice while the first save is still running. */
export const DoublePressOnSave = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="${surface}">
					<console-button variant="filled" icon="check" action.bind="() => save()" pending-label="保存中…">保存する</console-button>
					<output data-testid="calls">\${calls}</output>
				</div>
			`,
			props: {
				calls: 0,
				save(this: { calls: number }): Promise<void> {
					this.calls++
					return new Promise<void>((resolve) => {
						finishSave = resolve
					})
				},
			},
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Double press on save"
		const canvas = within(canvasElement)
		const button = canvas.getByRole('button', { name: '保存する' })
		const idle = button.getBoundingClientRect()

		await userEvent.click(button)
		// The pending button is aria-disabled, which Playwright waits on; a person
		// can still press it, so the second press skips that wait.
		await userEvent.click(button, { force: true })

		await expect(canvas.getByTestId('calls')).toHaveTextContent('1')
		await expect(
			canvas.getByRole('progressbar', { name: '保存中…' }),
		).toBeVisible()
		await expect(button).toHaveAttribute('aria-busy', 'true')
		const pending = button.getBoundingClientRect()
		await expect(pending.width).toBe(idle.width)
		await expect(pending.height).toBe(idle.height)

		finishSave?.()
		await waitFor(() => expect(canvas.queryByRole('progressbar')).toBeNull())
		await expect(button).not.toHaveAttribute('aria-busy')
		await expect(canvas.getByTestId('calls')).toHaveTextContent('1')
	},
} satisfies Story

const stateTemplate = `
	<div style="${surface}">
		<console-button data-testid="first" variant="outlined">戻る</console-button>
		<console-button data-testid="save" variant="filled">保存する</console-button>
	</div>
`

export const PointerHover = {
	render: () => defineAureliaStory({ template: stateTemplate }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Pointer hover"
		const save = canvasElement.querySelector<HTMLElement>(
			'[data-testid="save"]',
		)
		if (!save) throw new Error('save not rendered')
		await expect(stateLayerOpacity(save)).toBe(0)

		await userEvent.hover(save.querySelector('button') as HTMLElement)

		await waitFor(() => expect(stateLayerOpacity(save)).toBeCloseTo(0.08, 5))
	},
} satisfies Story

export const KeyboardFocus = {
	render: () => defineAureliaStory({ template: stateTemplate }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Keyboard focus"
		const save = canvasElement.querySelector<HTMLElement>(
			'[data-testid="save"]',
		)
		const button = save?.querySelector('button')
		if (!save || !button) throw new Error('save not rendered')
		;(
			canvasElement.querySelector('[data-testid="first"] button') as HTMLElement
		).focus()

		await userEvent.tab()

		await expect(document.activeElement).toBe(button)
		await expect(button.matches(':focus-visible')).toBe(true)
		await waitFor(() => expect(stateLayerOpacity(save)).toBeCloseTo(0.1, 5))
		const ring = getComputedStyle(button)
		await expect(ring.outlineStyle).toBe('solid')
		await expect(Number.parseFloat(ring.outlineWidth)).toBeGreaterThanOrEqual(2)
	},
} satisfies Story

export const PointerClick = {
	render: () => defineAureliaStory({ template: stateTemplate }),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/action-feedback "Pointer click"
		const save = canvasElement.querySelector<HTMLElement>(
			'[data-testid="save"]',
		)
		const button = save?.querySelector('button')
		if (!save || !button) throw new Error('save not rendered')

		await commands.pressAndHold('[data-testid="save"] button')
		try {
			await waitFor(() => expect(stateLayerOpacity(save)).toBeCloseTo(0.1, 5))
		} finally {
			await commands.releasePointer()
		}

		// Focused by the click, but no ring: the focus is not keyboard focus.
		await expect(document.activeElement).toBe(button)
		await expect(button.matches(':focus-visible')).toBe(false)
		await expect(getComputedStyle(button).outlineStyle).toBe('none')
	},
} satisfies Story
