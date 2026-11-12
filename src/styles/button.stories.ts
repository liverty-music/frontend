import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, waitFor } from 'storybook/test'
import { composite, contrast, WCAG_AA } from '../../.storybook/contrast'
import {
	parkPointerAway,
	pressAndHold,
	releasePointer,
} from '../../.storybook/gestures'
import { expectScreenshot } from '../../.storybook/screenshot'
import { expectTargets } from '../../.storybook/target-size'

/**
 * Foundations story for the shared text button (`src/styles/button.css`), a
 * global block every route and component opts into with markup only. The
 * catalog renders each variant as a <button> and as an <a>; on-container sits
 * on the brand gradient it is made for, so axe checks its real contrast.
 */
const meta = {
	title: 'Foundations/Button',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const VARIANTS = ['', 'outlined', 'danger', 'on-container'] as const

function row(variant: (typeof VARIANTS)[number]): string {
	const attr = variant ? ` data-variant="${variant}"` : ''
	const name = variant || 'filled'
	return `
		<div data-row="${name}" style="display:flex; gap:0.75rem; align-items:center; padding:0.75rem; ${
			variant === 'on-container'
				? 'background:linear-gradient(to right, var(--color-brand-primary), var(--color-brand-secondary))'
				: ''
		}">
			<button type="button" class="[ button ] [ state-layer ]"${attr}>${name} button</button>
			<a href="#" class="[ button ] [ state-layer ]"${attr}>${name} link</a>
		</div>`
}

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: HTMLElement,
	property: 'backgroundColor' | 'color',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style[property] = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

export const Catalog = {
	render: () =>
		defineAureliaStory({
			template: `<div style="display:flex; flex-direction:column; gap:0.5rem; padding:1rem; background:var(--md-sys-color-surface)">${VARIANTS.map(row).join('')}</div>`,
		}),
	play: async ({ canvasElement }) => {
		const buttons = (name: string) =>
			Array.from(
				canvasElement.querySelectorAll<HTMLElement>(
					`[data-row="${name}"] .button`,
				),
			)

		// The default size is the Material 3 small button: 40 px tall, with a
		// 48 px target through its ::after.
		for (const el of canvasElement.querySelectorAll<HTMLElement>('.button')) {
			await expect(el.getBoundingClientRect().height).toBe(40)
		}
		expectTargets(canvasElement, '.button')

		// Every variant shares the shape (12px corners) on both elements.
		for (const el of canvasElement.querySelectorAll<HTMLElement>('.button')) {
			await expect(getComputedStyle(el).borderTopLeftRadius).toBe('12px')
		}

		// @spec components/infrastructure/fan/web/global/ui-primitives "Default variant"
		// The primary role pair: its fill with the white on-primary label at
		// 4.5:1 or more, so a label of any size passes.
		const primary = resolved(
			canvasElement,
			'backgroundColor',
			'var(--md-sys-color-primary)',
		)
		const white = resolved(canvasElement, 'color', 'var(--color-white)')
		for (const el of buttons('filled')) {
			const style = getComputedStyle(el)
			await expect(style.backgroundColor).toBe(primary)
			await expect(style.color).toBe(white)
			await expect(
				contrast(composite(style.backgroundColor), composite(style.color)),
			).toBeGreaterThanOrEqual(WCAG_AA)
		}

		// Outlined: transparent with a visible border.
		for (const el of buttons('outlined')) {
			const style = getComputedStyle(el)
			await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
			await expect(Number.parseFloat(style.borderTopWidth)).toBeGreaterThan(0)
			await expect(style.borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
		}

		// Danger: a solid red fill with white text.
		const red = resolved(
			canvasElement,
			'backgroundColor',
			'var(--md-sys-color-error-container)',
		)
		for (const el of buttons('danger')) {
			await expect(getComputedStyle(el).backgroundColor).toBe(red)
		}

		// @spec components/infrastructure/fan/web/global/ui-primitives "Button on a coloured surface"
		for (const el of buttons('on-container')) {
			const style = getComputedStyle(el)
			await expect(
				Number.parseFloat(style.borderTopWidth),
			).toBeGreaterThanOrEqual(1.5)
			await expect(style.borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
			// Translucent white: a fill whose alpha is neither 0 nor 1.
			const alpha = new OffscreenCanvas(1, 1).getContext('2d')
			if (!alpha) throw new Error('no 2d context')
			alpha.fillStyle = style.backgroundColor
			alpha.fillRect(0, 0, 1, 1)
			const a = alpha.getImageData(0, 0, 1, 1).data[3]
			await expect(a).toBeGreaterThan(0)
			await expect(a).toBeLessThan(255)
		}

		// @spec components/infrastructure/fan/web/global/ui-primitives "Catalog matches the specification"
		await expectScreenshot(canvasElement, 'button-catalog')
	},
} satisfies Story

/**
 * The compact size (`data-size="compact"`), the Material 3 extra-small button
 * (https://m3.material.io/components/buttons/specs, "Button - Size - Xsmall"):
 * 32px tall, the label 12px from the container's edge, label-large, and a
 * 48px tap target around it. Filled, outlined and on-container, the three
 * variants its users (bottom banner, settings row, snack bar) draw.
 */
export const Compact = {
	render: () =>
		defineAureliaStory({
			template: `
				<div style="display:flex; flex-direction:column; gap:0.5rem; padding:1rem; background:var(--md-sys-color-surface)">
					<div style="display:flex; gap:0.75rem; align-items:center; padding:0.75rem">
						<button type="button" class="[ button ] [ state-layer ]" data-size="compact">登録する</button>
						<button type="button" class="[ button ] [ state-layer ]" data-size="compact" data-variant="outlined">再送する</button>
					</div>
					<div style="display:flex; gap:0.75rem; align-items:center; padding:0.75rem; background:linear-gradient(to right, var(--color-brand-primary), var(--color-brand-secondary))">
						<button type="button" class="[ button ] [ state-layer ]" data-size="compact" data-variant="on-container">更新する</button>
					</div>
				</div>`,
		}),
	play: async ({ canvasElement }) => {
		const label = document.createElement('span')
		label.className = 'md-typescale-label-large'
		canvasElement.append(label)
		const labelLarge = getComputedStyle(label)
		const [size, lineHeight, weight] = [
			labelLarge.fontSize,
			labelLarge.lineHeight,
			labelLarge.fontWeight,
		]
		label.remove()
		for (const el of canvasElement.querySelectorAll<HTMLElement>(
			'.button[data-size="compact"]',
		)) {
			const style = getComputedStyle(el)
			const box = el.getBoundingClientRect()
			await expect(box.height).toBe(32)
			// The label 12px from the container's edge: border + padding.
			await expect(
				Number.parseFloat(style.borderLeftWidth) +
					Number.parseFloat(style.paddingLeft),
			).toBe(12)
			await expect(style.fontSize).toBe(size)
			await expect(style.lineHeight).toBe(lineHeight)
			await expect(style.fontWeight).toBe(weight)
			await expect(style.borderTopLeftRadius).toBe('12px')
			// The tap target: a 48px box centred on the button.
			const target = getComputedStyle(el, '::after')
			await expect(target.content).toBe('""')
			await expect(Number.parseFloat(target.height)).toBe(48)
			await expect(Number.parseFloat(target.width)).toBeGreaterThanOrEqual(48)
		}
		// @spec components/infrastructure/fan/web/global/design-tokens "Compact button"
		expectTargets(canvasElement, '.button')
		await expectScreenshot(canvasElement, 'button-compact')
	},
} satisfies Story

/**
 * A real press on a button drawn as a link (the discover call to action):
 * the state layer rises to 10 % and the corners square from 12 px to the
 * Material 3 Expressive pressed 8 px; nothing scales. Released, both go back.
 */
export const PressedShape = {
	render: () =>
		defineAureliaStory({
			template: `<div style="padding:1rem"><a href="#discover" class="[ button ] [ state-layer ]" data-testid="discover-link" onclick="event.preventDefault()">発見する</a></div>`,
		}),
	play: async ({ canvasElement }) => {
		const cta = canvasElement.querySelector<HTMLElement>('a.button')
		if (!cta) throw new Error('no button')
		const layer = () =>
			Number.parseFloat(getComputedStyle(cta, '::before').opacity)
		const radius = () => getComputedStyle(cta).borderTopLeftRadius
		await expect(radius()).toBe('12px')
		await expect(layer()).toBe(0)
		// @spec components/infrastructure/fan/web/global/app-shell "Pressing a control shows the state layer and shape change"
		if (!(await pressAndHold('a.button'))) return
		try {
			await waitFor(() => expect(layer()).toBeCloseTo(0.1, 5))
			// The Material 3 Expressive pressed shape: the corners square to 8px.
			await waitFor(() => expect(radius()).toBe('8px'))
			await expect(getComputedStyle(cta).transform).toBe('none')
		} finally {
			await releasePointer()
			await parkPointerAway()
		}
		await waitFor(() => expect(radius()).toBe('12px'))
	},
} satisfies Story
