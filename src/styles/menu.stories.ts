import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor } from 'storybook/test'
import { hoverPointer } from '../../.storybook/gestures'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the menu both apps share (`shared/styles/menu.css`),
 * a Material 3 baseline menu, as the fan app draws it. One story per item
 * state; each checks the M3 values (`surface-container`, 4px corners,
 * elevation level 2, 8px above and below the items, 112px to 280px wide; 48px
 * items with 12px side padding and an `on-surface` label; the state layer
 * opacities) and axe checks the label contrast. The console's users are the
 * overflow menu and the top app bar's menus.
 */
const meta = {
	title: 'Foundations/Menu',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const item = (label: string, attrs = '') =>
	`<button type="button" role="menuitem" class="[ menu-item ] [ state-layer ] [ md-typescale-label-large ]" ${attrs}>${label}</button>`

/** A menu shown in place (not a popover), on the page surface. */
function menu(items: string): string {
	return `
		<div style="padding:16px; background:var(--md-sys-color-surface)">
			<div role="menu" aria-label="その他の操作" class="menu" style="inline-size:max-content">${items}</div>
		</div>`
}

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: HTMLElement,
	property: 'backgroundColor' | 'color' | 'boxShadow',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style.color = value
	probe.style.backgroundColor = value
	probe.style.boxShadow = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

function items(canvasElement: HTMLElement): HTMLElement[] {
	return Array.from(canvasElement.querySelectorAll<HTMLElement>('.menu-item'))
}

/** The M3 menu container and the item every state shares. */
async function expectMenu(canvasElement: HTMLElement): Promise<void> {
	const el = canvasElement.querySelector<HTMLElement>('.menu')
	if (!el) throw new Error('no menu')
	const style = getComputedStyle(el)
	await expect(style.backgroundColor).toBe(
		resolved(
			canvasElement,
			'backgroundColor',
			'var(--md-sys-color-surface-container)',
		),
	)
	await expect(style.borderTopLeftRadius).toBe('4px')
	await expect(style.paddingTop).toBe('8px')
	await expect(style.paddingBottom).toBe('8px')
	await expect(style.minWidth).toBe('112px')
	await expect(style.maxWidth).toBe('280px')
	await expect(style.boxShadow).toBe(
		resolved(canvasElement, 'boxShadow', 'var(--md-sys-elevation-level2)'),
	)
	const width = el.getBoundingClientRect().width
	for (const i of items(canvasElement)) {
		const box = i.getBoundingClientRect()
		await expect(box.height).toBe(48)
		await expect(box.width).toBe(width)
		await expect(getComputedStyle(i).paddingInlineStart).toBe('12px')
		await expect(getComputedStyle(i).paddingInlineEnd).toBe('12px')
	}
}

const layer = (el: HTMLElement) =>
	Number.parseFloat(getComputedStyle(el, '::before').opacity)

const ITEMS = `${item('中止する')}${item('公演を編集')}`

export const Rest = {
	render: () => defineAureliaStory({ template: menu(ITEMS) }),
	play: async ({ canvasElement }) => {
		await expectMenu(canvasElement)
		const label = resolved(
			canvasElement,
			'color',
			'var(--md-sys-color-on-surface)',
		)
		for (const i of items(canvasElement)) {
			await expect(getComputedStyle(i).color).toBe(label)
			await expect(layer(i)).toBe(0)
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'menu-rest',
		)
	},
} satisfies Story

/** A real pointer over an item raises the 8 % state layer. */
export const HoveredItem = {
	render: () => defineAureliaStory({ template: menu(ITEMS) }),
	play: async ({ canvasElement }) => {
		await expectMenu(canvasElement)
		const [first] = items(canvasElement)
		if (!(await hoverPointer(first))) return
		await waitFor(() => expect(layer(first)).toBeCloseTo(0.08, 2))
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'menu-hovered-item',
		)
	},
} satisfies Story

/** Keyboard focus: the ring inside the item and the 10 % state layer. */
export const FocusedItem = {
	render: () => defineAureliaStory({ template: menu(ITEMS) }),
	play: async ({ canvasElement }) => {
		await expectMenu(canvasElement)
		const [first] = items(canvasElement)
		await userEvent.tab()
		await expect(first).toHaveFocus()
		const style = getComputedStyle(first)
		// The fan app has no ring of its own yet (task 6.1): the browser's,
		// drawn inside the item.
		await expect(style.outlineStyle).not.toBe('none')
		await expect(style.outlineOffset).toBe('-3px')
		await waitFor(() => expect(layer(first)).toBeCloseTo(0.1, 2))
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'menu-focused-item',
		)
	},
} satisfies Story

/** An unavailable item stays in the menu at 38 %, with no state layer. */
export const DisabledItem = {
	render: () =>
		defineAureliaStory({
			template: menu(
				`${item('公演を中止', 'aria-disabled="true"')}${item('公演を編集')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		await expectMenu(canvasElement)
		const [disabled] = items(canvasElement)
		await expect(getComputedStyle(disabled).color).toBe(
			resolved(
				canvasElement,
				'color',
				'color-mix(in oklch, var(--md-sys-color-on-surface) 38%, transparent)',
			),
		)
		if (await hoverPointer(disabled)) await expect(layer(disabled)).toBe(0)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'menu-disabled-item',
		)
	},
} satisfies Story
