import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
// `expect.element(...).toMatchScreenshot()` is a @vitest/browser matcher, only
// present on Vitest's own `expect` (not the one re-exported by `storybook/test`).
import { expect as vitestExpect } from 'vitest'

/**
 * Foundations story for the shared text button (`src/styles/button.css`), a
 * global block every route and component opts into with markup only. The
 * catalog renders each variant as a <button> and as an <a>; on-container sits
 * on the brand gradient it is made for, so axe checks its real contrast.
 */
const meta = {
	title: 'Foundations/Button',
	tags: ['test', 'autodocs'],
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
			<button type="button" class="[ button ] [ pressable ]"${attr}>${name} button</button>
			<a href="#" class="[ button ] [ pressable ]"${attr}>${name} link</a>
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
			template: `<div style="display:flex; flex-direction:column; gap:0.5rem; padding:1rem; background:var(--color-surface-base)">${VARIANTS.map(row).join('')}</div>`,
		}),
	play: async ({ canvasElement }) => {
		const buttons = (name: string) =>
			Array.from(
				canvasElement.querySelectorAll<HTMLElement>(
					`[data-row="${name}"] .button`,
				),
			)

		// Every variant shares the shape (12px corners) on both elements.
		for (const el of canvasElement.querySelectorAll<HTMLElement>('.button')) {
			await expect(getComputedStyle(el).borderTopLeftRadius).toBe('12px')
		}

		// @spec components/infrastructure/fan/web/global/ui-primitives "Default variant"
		const brand = resolved(
			canvasElement,
			'backgroundColor',
			'var(--color-brand-primary)',
		)
		const white = resolved(canvasElement, 'color', 'var(--color-white)')
		for (const el of buttons('filled')) {
			const style = getComputedStyle(el)
			await expect(style.backgroundColor).toBe(brand)
			await expect(style.color).toBe(white)
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
			'var(--md-color-error-container)',
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
		await vitestExpect
			.element(canvasElement)
			.toMatchScreenshot('button-catalog', {
				comparatorName: 'pixelmatch',
				comparatorOptions: { allowedMismatchedPixelRatio: 0.001 },
			})
	},
} satisfies Story
