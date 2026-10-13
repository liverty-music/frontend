import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { commands, userEvent } from 'vitest/browser'
import {
	canvasOf,
	consoleStoryParameters,
	contrastRatio,
	deepQuery,
	deepQueryAll,
	focusedElement,
} from '../story-support'
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

/** The button (or link) in the shadow root of a `<console-button>`. */
function controlOf(host: HTMLElement): HTMLElement {
	return deepQuery(host, 'button, a')
}

/** Opacity of the state layer (`::before`) of the button inside `host`. */
function stateLayerOpacity(host: HTMLElement): number {
	return Number(getComputedStyle(controlOf(host), '::before').opacity)
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
					<console-button variant="text" icon="edit" disabled.bind="true">変更不可</console-button>
					<console-button variant="text" href="#concerts">公演一覧へ</console-button>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		const canvas = canvasOf(canvasElement)
		// The link variant is a link, every other one a button.
		await expect(
			canvas.getByRole('link', { name: '公演一覧へ' }).element(),
		).toBeVisible()
		await expect(
			canvas.getByRole('button', { name: '保存する' }).element(),
		).toBeDisabled()
		// A disabled text button stays borderless.
		const lockedText = canvas
			.getByRole('button', { name: '変更不可' })
			.element() as HTMLElement
		await expect(getComputedStyle(lockedText).borderTopColor).toBe(
			'rgba(0, 0, 0, 0)',
		)
		// Every control answers taps on at least 48 × 48 px.
		for (const control of deepQueryAll(canvasElement, 'button, a')) {
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
		const canvas = canvasOf(canvasElement)
		await expect(
			canvas.getByRole('progressbar', { name: '保存中…' }).element(),
		).toBeVisible()
		await expect(
			deepQuery(canvasElement, '[data-role="pending"]'),
		).toBeVisible()
		await expect(
			deepQuery(canvasElement, '[data-role="pending"]'),
		).toHaveTextContent('保存中…')
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
		const canvas = canvasOf(canvasElement)
		const button = canvas.getByRole('button', { name: '保存する' }).element()
		const idle = button.getBoundingClientRect()

		await userEvent.click(button)
		// The pending button is aria-disabled, which Playwright waits on; a person
		// can still press it, so the second press skips that wait.
		await userEvent.click(button, { force: true })

		await expect(canvas.getByTestId('calls').element()).toHaveTextContent('1')
		await expect(
			canvas.getByRole('progressbar', { name: '保存中…' }).element(),
		).toBeVisible()
		await expect(button).toHaveAttribute('aria-busy', 'true')
		const pending = button.getBoundingClientRect()
		await expect(pending.width).toBe(idle.width)
		await expect(pending.height).toBe(idle.height)

		finishSave?.()
		await waitFor(() =>
			expect(canvas.getByRole('progressbar').query()).toBeNull(),
		)
		await expect(button).not.toHaveAttribute('aria-busy')
		await expect(canvas.getByTestId('calls').element()).toHaveTextContent('1')
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

		await userEvent.hover(controlOf(save))

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
		if (!save) throw new Error('save not rendered')
		const button = controlOf(save)
		controlOf(
			canvasElement.querySelector('[data-testid="first"]') as HTMLElement,
		).focus()

		await userEvent.tab()

		await expect(focusedElement()).toBe(button)
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
		if (!save) throw new Error('save not rendered')
		const button = controlOf(save)

		await commands.pressAndHold('[data-testid="save"] button')
		try {
			await waitFor(() => expect(stateLayerOpacity(save)).toBeCloseTo(0.1, 5))
		} finally {
			await commands.releasePointer()
		}

		// Focused by the click, but no ring: the focus is not keyboard focus.
		await expect(focusedElement()).toBe(button)
		await expect(button.matches(':focus-visible')).toBe(false)
		await expect(getComputedStyle(button).outlineStyle).toBe('none')
	},
} satisfies Story

/**
 * A page that styles its own `.label`, as Settings did, around a filled button
 * in dark mode. The page rule reaches the page's label and stops at the
 * button's shadow root, so the button's label keeps its on-primary color.
 */
export const PageLabelStyle = {
	render: () =>
		defineAureliaStory({
			template: `
				<div class="page" style="color-scheme:dark; ${surface}">
					<style>
						@scope (.page) {
							.label {
								font: var(--md-type-label-large);
								color: var(--md-color-on-surface-variant);
							}
						}
					</style>
					<h3 class="label" data-testid="page-label">入金口座</h3>
					<console-button variant="filled" href="#onboarding">登録を続ける</console-button>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		// @spec components/infrastructure/organizer/web/global/design-tokens "Button on Settings"
		const pageLabel = canvasOf(canvasElement)
			.getByTestId('page-label')
			.element()
		const link = canvasOf(canvasElement)
			.getByRole('link', { name: '登録を続ける' })
			.element()
		const buttonLabel = deepQuery(link, '.label')
		const linkStyle = getComputedStyle(link)

		// The page rule is live: it colors the page's own label.
		await expect(getComputedStyle(pageLabel).color).not.toBe(linkStyle.color)
		// It does not reach the label inside the button.
		await expect(getComputedStyle(buttonLabel).color).toBe(linkStyle.color)
		await expect(
			contrastRatio(
				getComputedStyle(buttonLabel).color,
				linkStyle.backgroundColor,
			),
		).toBeGreaterThanOrEqual(4.5)
	},
} satisfies Story
