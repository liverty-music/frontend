import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect, userEvent, waitFor } from 'storybook/test'
import { composite, contrast, WCAG_AA } from '../../.storybook/contrast'
import { expectScreenshot } from '../../.storybook/screenshot'
import { expectTargets } from '../../.storybook/target-size'

/**
 * Foundations story for the shared chip (`src/styles/chip.css`), a Material 3
 * filter chip on the native <button>, or on the <label> around a visually
 * hidden checkbox. One story per state; each checks the M3 values (32px tall,
 * 8px corners, a 48px target, the role colours) and axe checks contrast.
 */
const meta = {
	title: 'Foundations/Chip',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const CLASS = 'class="[ chip ] [ state-layer ] [ md-typescale-label-large ]"'

/** Chips the way the sheets lay them out: a cluster on a sheet surface. */
function row(chips: string, width = '20rem'): string {
	return `
		<div style="padding:1rem; inline-size:${width}; box-sizing:border-box; background:var(--md-sys-color-surface-container-high)">
			<div class="[ cluster ]" role="group" aria-label="ジャンル" style="--cluster-gap: var(--space-s) var(--space-2xs)">${chips}</div>
		</div>`
}

const button = (label: string, attrs = '') =>
	`<button type="button" ${CLASS} ${attrs}>${label}</button>`

const checkbox = (label: string, attrs = '') =>
	`<label ${CLASS}><input type="checkbox" class="visually-hidden" ${attrs} /><span>${label}</span></label>`

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: HTMLElement,
	property: 'backgroundColor' | 'borderTopColor' | 'color',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style.border = `1px solid ${value}`
	probe.style.color = value
	probe.style.backgroundColor = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

function chips(canvasElement: HTMLElement): HTMLElement[] {
	return Array.from(canvasElement.querySelectorAll<HTMLElement>('.chip'))
}

/** The M3 filter chip shape every state shares, and its 48px target. */
async function expectShape(el: HTMLElement): Promise<void> {
	const style = getComputedStyle(el)
	await expect(el.getBoundingClientRect().height).toBe(32)
	await expect(style.borderTopLeftRadius).toBe('8px')
	await expect(style.borderTopWidth).toBe('1px')
	const target = getComputedStyle(el, '::after')
	await expect(Number.parseFloat(target.height)).toBe(48)
	await expect(Number.parseFloat(target.width)).toBeGreaterThanOrEqual(48)
}

export const Unselected = {
	render: () =>
		defineAureliaStory({
			template: row(
				`${button('Rock', 'aria-pressed="false"')}${checkbox('1 YOASOBI')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		const outline = resolved(
			canvasElement,
			'borderTopColor',
			'var(--md-sys-color-outline-variant)',
		)
		const label = resolved(
			canvasElement,
			'color',
			'var(--md-sys-color-on-surface-variant)',
		)
		for (const el of chips(canvasElement)) {
			await expectShape(el)
			const style = getComputedStyle(el)
			await expect(style.borderTopColor).toBe(outline)
			await expect(style.color).toBe(label)
			await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'chip-unselected',
		)
	},
} satisfies Story

export const Selected = {
	render: () =>
		defineAureliaStory({
			template: row(
				`${button('Pop', 'aria-pressed="true"')}${checkbox('1 King Gnu', 'checked')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		const container = resolved(
			canvasElement,
			'backgroundColor',
			'var(--md-sys-color-secondary-container)',
		)
		const label = resolved(
			canvasElement,
			'color',
			'var(--md-sys-color-on-secondary-container)',
		)
		for (const el of chips(canvasElement)) {
			await expectShape(el)
			const style = getComputedStyle(el)
			await expect(style.backgroundColor).toBe(container)
			await expect(style.color).toBe(label)
			await expect(style.borderTopColor).toBe('rgba(0, 0, 0, 0)')
			await expect(
				contrast(composite(style.backgroundColor), composite(style.color)),
			).toBeGreaterThanOrEqual(WCAG_AA)
		}
		// A label chip follows its checkbox.
		// A label chip follows its checkbox (after the colour transition).
		const chip = canvasElement.querySelector<HTMLElement>('label.chip')
		if (!chip) throw new Error('no label chip')
		await userEvent.click(chip)
		await waitFor(() =>
			expect(getComputedStyle(chip).backgroundColor).toBe('rgba(0, 0, 0, 0)'),
		)
		await userEvent.click(chip)
		await userEvent.unhover(chip)
		await waitFor(() =>
			expect(getComputedStyle(chip).backgroundColor).toBe(container),
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'chip-selected',
		)
	},
} satisfies Story

/**
 * Filter chips the way the sheets bind them: a check icon is rendered as the
 * leading icon only while a chip is selected, and on the journey chip it
 * takes the place of the status icon.
 */
export const SelectedWithCheck = {
	render: () =>
		defineAureliaStory({
			template: row(`
				<button repeat.for="g of genres" type="button" ${CLASS}
					aria-pressed.bind="active === g" click.trigger="active = g">
					<svg-icon if.bind="active === g" name="check" class="chip-icon"></svg-icon>
					<span>\${g}</span>
				</button>
				<label ${CLASS}>
					<input type="checkbox" class="visually-hidden" checked.bind="paid" />
					<svg-icon if.bind="paid" name="check" class="chip-icon"></svg-icon>
					<span else class="chip-icon" aria-hidden="true">🎟️</span>
					<span>入金済み</span>
				</label>`),
			props: { genres: ['Rock', 'Pop', 'Jazz'], active: 'Pop', paid: false },
		}),
	play: async ({ canvasElement }) => {
		const all = chips(canvasElement)
		const checks = () =>
			all.map((el) => el.querySelector('svg-icon.chip-icon') !== null)
		const selected = () =>
			all.map(
				(el) =>
					el.getAttribute('aria-pressed') === 'true' ||
					el.querySelector<HTMLInputElement>('input')?.checked === true,
			)
		await waitFor(() => expect(checks()).toEqual([false, true, false, false]))
		await expect(checks()).toEqual(selected())

		// The check is the 18px leading icon, 8px from the chip's edge.
		const pop = all[1]
		const icon = pop.querySelector<HTMLElement>('svg-icon')
		if (!icon) throw new Error('no check icon')
		await expect(icon.getBoundingClientRect().width).toBe(18)
		await expect(getComputedStyle(pop).paddingInlineStart).toBe('8px')
		await expect(getComputedStyle(all[0]).paddingInlineStart).toBe('16px')

		// Selecting moves the check; a journey chip trades its status icon.
		await userEvent.click(all[0])
		await userEvent.click(all[3])
		await waitFor(() => expect(checks()).toEqual([true, false, false, true]))
		await expect(checks()).toEqual(selected())
		await expect(all[3].textContent).not.toContain('🎟️')
		await userEvent.click(all[3])
		await waitFor(() => expect(checks()).toEqual([true, false, false, false]))
		await expect(all[3].textContent).toContain('🎟️')
		await userEvent.click(all[1])
		await userEvent.unhover(all[1])
		await waitFor(() => expect(checks()).toEqual([false, true, false, false]))
		// The baseline shows the selected look, not a focus ring.
		all[1].blur()
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'chip-selected-with-check',
		)
	},
} satisfies Story

export const Disabled = {
	render: () =>
		defineAureliaStory({
			template: row(
				`${button('Rock', 'aria-pressed="false" disabled')}${button('Pop', 'aria-pressed="true" disabled')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		const dim = resolved(
			canvasElement,
			'color',
			'color-mix(in oklch, var(--md-sys-color-on-surface) 38%, transparent)',
		)
		const faint = resolved(
			canvasElement,
			'backgroundColor',
			'color-mix(in oklch, var(--md-sys-color-on-surface) 12%, transparent)',
		)
		const [unselected, selected] = chips(canvasElement)
		for (const el of [unselected, selected]) {
			await expectShape(el)
			await expect(getComputedStyle(el).color).toBe(dim)
		}
		await expect(getComputedStyle(unselected).borderTopColor).toBe(faint)
		await expect(getComputedStyle(unselected).backgroundColor).toBe(
			'rgba(0, 0, 0, 0)',
		)
		await expect(getComputedStyle(selected).backgroundColor).toBe(faint)
		await expect(getComputedStyle(selected).borderTopColor).toBe(
			'rgba(0, 0, 0, 0)',
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'chip-disabled',
		)
	},
} satisfies Story

export const Focused = {
	render: () =>
		defineAureliaStory({
			template: row(
				`${button('Rock', 'aria-pressed="false"')}${checkbox('1 YOASOBI')}`,
			),
		}),
	play: async ({ canvasElement }) => {
		const [chip, label] = chips(canvasElement)
		const ring = async (el: HTMLElement) => {
			const style = getComputedStyle(el)
			await expect(style.outlineStyle).toBe('solid')
			await expect(style.outlineWidth).toBe('3px')
			await expect(style.outlineOffset).toBe('2px')
			// The focus state layer is raised.
			await waitFor(() =>
				expect(
					Number.parseFloat(getComputedStyle(el, '::before').opacity),
				).toBeGreaterThan(0),
			)
		}
		// Real keyboard focus: Tab onto the button, then onto the checkbox
		// a label chip stands for.
		await userEvent.tab()
		await expect(chip).toHaveFocus()
		await expectShape(chip)
		await ring(chip)
		await userEvent.tab()
		await expect(label.querySelector('input')).toHaveFocus()
		await ring(label)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'chip-focused',
		)
	},
} satisfies Story

const GENRES = ['Rock', 'Pop', 'Anime', 'Jazz', 'Electronic', 'Hip Hop', 'R&B']

export const WrappingRow = {
	render: () =>
		defineAureliaStory({
			template: row(
				GENRES.map((g) =>
					button(g, `aria-pressed="${g === 'Pop' ? 'true' : 'false'}"`),
				).join(''),
				'320px',
			),
		}),
	play: async ({ canvasElement }) => {
		const all = chips(canvasElement)
		const tops = new Set(all.map((el) => el.getBoundingClientRect().top))
		// The row wraps at 320px.
		await expect(tops.size).toBeGreaterThan(1)
		const box = canvasElement.querySelector('.cluster') as HTMLElement
		await expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
		// Rows stay a whole target apart: no two 48px targets overlap.
		const targets = all.map((el) => {
			const r = el.getBoundingClientRect()
			const extra = (48 - r.height) / 2
			return {
				top: r.top - extra,
				bottom: r.bottom + extra,
				left: r.left,
				right: r.right,
			}
		})
		for (const [i, a] of targets.entries()) {
			for (const b of targets.slice(i + 1)) {
				const overlap =
					a.left < b.right &&
					b.left < a.right &&
					a.top < b.bottom &&
					b.top < a.bottom
				await expect(overlap).toBe(false)
			}
		}
		// @spec components/infrastructure/fan/web/global/design-tokens "Neighbouring controls"
		expectTargets(canvasElement, '.chip')
		for (const el of all) await expectShape(el)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'chip-wrapping-row',
		)
	},
} satisfies Story
