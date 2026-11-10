import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor } from 'storybook/test'
import { hoverPointer } from '../../.storybook/gestures'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the icon button both apps share
 * (`shared/styles/icon-button.css`), a Material 3 standard icon button, as the
 * fan app draws it. One story per state; each checks the M3 values (a 40px
 * round container, a 24px icon, a 48px target, the role colours and the state
 * layer opacities) and axe runs on each. The console's users are
 * `organizer/ui/icon-button/icon-button.stories.ts` and the overflow menu.
 */
const meta = {
	title: 'Foundations/IconButton',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const CLOSE =
	'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path></svg>'

/** Icon buttons the way a surface lays them out: a row on the page surface. */
function row(buttons: string): string {
	return `
		<div style="display:flex; gap:8px; padding:16px; background:var(--md-sys-color-surface)">${buttons}</div>`
}

const button = (label: string, attrs = '') =>
	`<button type="button" class="icon-button" aria-label="${label}" ${attrs}>${CLOSE}</button>`

/** The computed colour of `value`, painted on a probe. */
function resolved(root: HTMLElement, value: string): string {
	const probe = document.createElement('span')
	probe.style.color = value
	root.append(probe)
	const out = getComputedStyle(probe).color
	probe.remove()
	return out
}

function buttons(canvasElement: HTMLElement): HTMLElement[] {
	return Array.from(canvasElement.querySelectorAll<HTMLElement>('.icon-button'))
}

/** The M3 small icon button every state shares. */
async function expectShape(el: HTMLElement): Promise<void> {
	const box = el.getBoundingClientRect()
	await expect(box.width).toBe(40)
	await expect(box.height).toBe(40)
	const style = getComputedStyle(el)
	await expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(20)
	await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
	const icon = el.querySelector('svg')?.getBoundingClientRect()
	await expect(icon?.width).toBe(24)
	await expect(icon?.height).toBe(24)
	const target = getComputedStyle(el, '::after')
	await expect(target.width).toBe('48px')
	await expect(target.height).toBe('48px')
}

const layer = (el: HTMLElement) =>
	Number.parseFloat(getComputedStyle(el, '::before').opacity)

export const Rest = {
	render: () =>
		defineAureliaStory({
			template: row(
				`${button('閉じる')}${button('閉じる', 'aria-pressed="false"')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		const icon = resolved(
			canvasElement,
			'var(--md-sys-color-on-surface-variant)',
		)
		for (const el of buttons(canvasElement)) {
			await expectShape(el)
			await expect(getComputedStyle(el).color).toBe(icon)
			await expect(layer(el)).toBe(0)
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'icon-button-rest',
		)
	},
} satisfies Story

/** A real pointer over the button raises the 8 % state layer. */
export const Hovered = {
	render: () => defineAureliaStory({ template: row(button('閉じる')) }),
	play: async ({ canvasElement }) => {
		const [el] = buttons(canvasElement)
		await expectShape(el)
		if (!(await hoverPointer(el))) return
		await waitFor(() => expect(layer(el)).toBeCloseTo(0.08, 2))
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'icon-button-hovered',
		)
	},
} satisfies Story

/** Keyboard focus shows the app's ring and the 10 % state layer. */
export const Focused = {
	render: () => defineAureliaStory({ template: row(button('閉じる')) }),
	play: async ({ canvasElement }) => {
		const [el] = buttons(canvasElement)
		await userEvent.tab()
		await expect(el).toHaveFocus()
		await expectShape(el)
		// The fan app has no ring of its own yet (task 6.1): the browser's.
		await expect(getComputedStyle(el).outlineStyle).not.toBe('none')
		await waitFor(() => expect(layer(el)).toBeCloseTo(0.1, 2))
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'icon-button-focused',
		)
	},
} satisfies Story

/** A toggle that is on draws its icon in `primary`. */
export const Selected = {
	render: () =>
		defineAureliaStory({
			template: row(button('閉じる', 'aria-pressed="true"')),
		}),
	play: async ({ canvasElement }) => {
		const [el] = buttons(canvasElement)
		await expectShape(el)
		await expect(getComputedStyle(el).color).toBe(
			resolved(canvasElement, 'var(--md-sys-color-primary)'),
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'icon-button-selected',
		)
	},
} satisfies Story

/** Disabled: `on-surface` at 38 %, and no state layer under the pointer. */
export const Disabled = {
	render: () =>
		defineAureliaStory({
			template: row(
				`${button('閉じる', 'disabled')}${button('削除', 'aria-disabled="true"')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		const dim = resolved(
			canvasElement,
			'color-mix(in oklch, var(--md-sys-color-on-surface) 38%, transparent)',
		)
		for (const el of buttons(canvasElement)) {
			await expectShape(el)
			await expect(getComputedStyle(el).color).toBe(dim)
			await expect(getComputedStyle(el).cursor).toBe('not-allowed')
		}
		const [el] = buttons(canvasElement)
		if (await hoverPointer(el)) await expect(layer(el)).toBe(0)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'icon-button-disabled',
		)
	},
} satisfies Story
