import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { composite, contrast } from '../../.storybook/contrast'
import { hoverPointer } from '../../.storybook/gestures'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the shared text field (`src/styles/text-field.css`),
 * a Material 3 outlined text field on the native control itself. One story
 * per state; each checks the M3 values (56px tall, 4px corners, the border in
 * its role colour) and axe checks the label and the text contrast.
 */
const meta = {
	title: 'Foundations/Text Field',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const CLASS = 'class="[ text-field ] [ md-typescale-body-large ]"'

/** A labelled field the way the routes lay it out: a `stack` label. */
function field(control: string, label = 'お名前（フルネーム）'): string {
	return `
		<div style="padding:1rem; inline-size:20rem; background:var(--md-sys-color-surface-container)">
			<label class="[ stack ]" style="--stack-gap: var(--space-2xs)">
				<span class="md-typescale-label-large">${label}</span>
				${control}
			</label>
		</div>`
}

const input = (attrs = '') =>
	field(`<input type="text" value="山田 花子" ${CLASS} ${attrs} />`)

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: HTMLElement,
	property: 'borderTopColor' | 'color',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style.border = `1px solid ${value}`
	probe.style.color = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

function control(canvasElement: HTMLElement): HTMLElement {
	const el = canvasElement.querySelector<HTMLElement>('.text-field')
	if (!el) throw new Error('no text field')
	return el
}

/**
 * Waits for the border to reach `color`: it eases between roles over a
 * transition, so a read right after a state change can see a midway value.
 * The retry throws a plain error because Storybook's instrumented `expect`
 * does not retry inside `waitFor`; the story then asserts the final value.
 */
async function borderSettlesOn(el: HTMLElement, color: string): Promise<void> {
	await waitFor(() => {
		if (getComputedStyle(el).borderTopColor !== color) {
			throw new Error(`border is still ${getComputedStyle(el).borderTopColor}`)
		}
	})
	await expect(getComputedStyle(el).borderTopColor).toBe(color)
}

/** The M3 outlined shape every state shares. */
/** 56 px tall, extra-small corners; the border is 2 px while focused. */
async function expectShape(el: HTMLElement): Promise<void> {
	const style = getComputedStyle(el)
	await expect(el.getBoundingClientRect().height).toBe(56)
	await expect(style.borderTopLeftRadius).toBe('4px')
	await expect(style.borderTopWidth).toBe(el.matches(':focus') ? '2px' : '1px')
}

export const Rest = {
	render: () => defineAureliaStory({ template: input() }),
	play: async ({ canvasElement }) => {
		const el = control(canvasElement)
		await expectShape(el)
		const style = getComputedStyle(el)
		await expect(style.borderTopColor).toBe(
			resolved(canvasElement, 'borderTopColor', 'var(--md-sys-color-outline)'),
		)
		// @spec components/infrastructure/fan/web/global/design-tokens "Control boundaries reach 3:1"
		// The border is the field's only edge: 3:1 against what is behind it.
		const behind = getComputedStyle(
			el.closest('div') as HTMLElement,
		).backgroundColor
		await expect(
			contrast(composite(behind, style.borderTopColor), composite(behind)),
		).toBeGreaterThanOrEqual(3)
		await expect(style.boxShadow).toBe('none')
		await expectScreenshot(el, 'text-field-rest')
	},
} satisfies Story

/** Hovered: the border takes `on-surface`; it is back to `outline` at rest. */
export const Hovered = {
	render: () => defineAureliaStory({ template: input() }),
	play: async ({ canvasElement }) => {
		const el = control(canvasElement)
		if (!(await hoverPointer(el))) return
		await borderSettlesOn(
			el,
			resolved(
				canvasElement,
				'borderTopColor',
				'var(--md-sys-color-on-surface)',
			),
		)
		await expect(getComputedStyle(el).borderTopWidth).toBe('1px')
	},
} satisfies Story

export const Focused = {
	render: () => defineAureliaStory({ template: input() }),
	play: async ({ canvasElement }) => {
		const el = control(canvasElement)
		// Real keyboard focus: Tab from the page into the field.
		await userEvent.tab()
		await expect(el).toHaveFocus()
		await expectShape(el)
		const primary = resolved(
			canvasElement,
			'borderTopColor',
			'var(--md-sys-color-primary)',
		)
		await borderSettlesOn(el, primary)
		const style = getComputedStyle(el)
		// A 2px primary border, its extra pixel taken from the padding, and
		// the app's keyboard focus ring outside it.
		await expect(style.borderTopWidth).toBe('2px')
		await expect(
			Number.parseFloat(style.paddingLeft) +
				Number.parseFloat(style.borderLeftWidth),
		).toBe(17)
		await expect(style.boxShadow).toBe('none')
		await expect(style.outlineStyle).toBe('solid')
		await expect(style.outlineWidth).toBe('3px')
		await expect(style.outlineOffset).toBe('2px')
		// @spec components/infrastructure/fan/web/global/ui-primitives "Text field caret"
		// The caret takes the primary colour (M3 outlined text field caret).
		await expect(style.caretColor).toBe(
			resolved(canvasElement, 'color', 'var(--md-sys-color-primary)'),
		)
		await expectScreenshot(el, 'text-field-focused')
	},
} satisfies Story

export const Invalid = {
	render: () =>
		defineAureliaStory({
			template: input(
				'aria-invalid="true" aria-describedby="name-error"',
			).replace(
				'</label>',
				'</label><p id="name-error" class="md-typescale-body-small" style="color:var(--md-sys-color-error)">入力してください</p>',
			),
		}),
	play: async ({ canvasElement }) => {
		const el = control(canvasElement)
		await expectShape(el)
		const error = resolved(
			canvasElement,
			'borderTopColor',
			'var(--md-sys-color-error)',
		)
		await borderSettlesOn(el, error)
		// Still the error colour while focused.
		await userEvent.tab()
		await expect(el).toHaveFocus()
		await borderSettlesOn(el, error)
		await expectScreenshot(el, 'text-field-invalid')
	},
} satisfies Story

export const Disabled = {
	render: () => defineAureliaStory({ template: input('disabled') }),
	play: async ({ canvasElement }) => {
		const el = control(canvasElement)
		await expectShape(el)
		const style = getComputedStyle(el)
		await expect(style.color).toBe(
			resolved(
				canvasElement,
				'color',
				'color-mix(in oklch, var(--md-sys-color-on-surface) 38%, transparent)',
			),
		)
		await expect(style.borderTopColor).toBe(
			resolved(
				canvasElement,
				'borderTopColor',
				'color-mix(in oklch, var(--md-sys-color-on-surface) 12%, transparent)',
			),
		)
		await expectScreenshot(el, 'text-field-disabled')
	},
} satisfies Story

export const Select = {
	render: () =>
		defineAureliaStory({
			template: field(
				`<select ${CLASS}><option value="1">1枚</option><option value="2" selected>2枚</option></select>`,
				'枚数',
			),
		}),
	play: async ({ canvasElement }) => {
		const el = control(canvasElement)
		await expectShape(el)
		await expect(getComputedStyle(el).borderTopColor).toBe(
			resolved(canvasElement, 'borderTopColor', 'var(--md-sys-color-outline)'),
		)
		await expect(
			within(canvasElement).getByRole('combobox', {
				name: '枚数',
			}),
		).toBe(el)
		await expectScreenshot(el, 'text-field-select')
	},
} satisfies Story
