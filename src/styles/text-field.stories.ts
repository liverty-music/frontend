import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, within } from 'storybook/test'
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

/** The M3 outlined shape every state shares. */
async function expectShape(el: HTMLElement): Promise<void> {
	const style = getComputedStyle(el)
	await expect(el.getBoundingClientRect().height).toBe(56)
	await expect(style.borderTopLeftRadius).toBe('4px')
	await expect(style.borderTopWidth).toBe('1px')
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
		await expect(style.boxShadow).toBe('none')
		await expectScreenshot(el, 'text-field-rest')
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
		const style = getComputedStyle(el)
		// A 2px primary indicator: the 1px border and a 1px inset shadow.
		await expect(style.borderTopColor).toBe(primary)
		await expect(style.boxShadow).toBe(`${primary} 0px 0px 0px 1px inset`)
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
		await expect(getComputedStyle(el).borderTopColor).toBe(error)
		// Still the error colour while focused.
		await userEvent.tab()
		await expect(el).toHaveFocus()
		await expect(getComputedStyle(el).borderTopColor).toBe(error)
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
