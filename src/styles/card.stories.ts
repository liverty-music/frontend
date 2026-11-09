import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the card both apps share (`shared/styles/card.css`),
 * a Material 3 outlined card, as the fan app draws it. Each story checks the
 * M3 values (`surface-container` fill, a 1px `outline-variant` border, 16px
 * corners, 16px padding) and axe checks the text contrast on the fill. The
 * console's card is `organizer/styles/card.stories.ts`.
 */
const meta = {
	title: 'Foundations/Card',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A card the way a fan screen lays one out: on the page's surface. */
function page(content: string): string {
	return `
		<div style="padding:1rem; inline-size:358px; box-sizing:border-box; background:var(--md-sys-color-surface)">${content}</div>`
}

/** The computed value of `property` for a probe painted with `value`. */
function resolved(
	root: HTMLElement,
	property: 'backgroundColor' | 'borderTopColor',
	value: string,
): string {
	const probe = document.createElement('span')
	probe.style.border = `1px solid ${value}`
	probe.style.backgroundColor = value
	root.append(probe)
	const out = getComputedStyle(probe)[property]
	probe.remove()
	return out
}

function card(canvasElement: HTMLElement): HTMLElement {
	const el = canvasElement.querySelector<HTMLElement>('.card')
	if (!el) throw new Error('no card')
	return el
}

/** The outlined card's fill, border and corners, whatever its padding. */
async function expectFrame(
	canvasElement: HTMLElement,
	el: HTMLElement,
): Promise<void> {
	const style = getComputedStyle(el)
	await expect(style.backgroundColor).toBe(
		resolved(
			canvasElement,
			'backgroundColor',
			'var(--md-sys-color-surface-container)',
		),
	)
	await expect(style.borderTopColor).toBe(
		resolved(
			canvasElement,
			'borderTopColor',
			'var(--md-sys-color-outline-variant)',
		),
	)
	await expect(style.borderTopWidth).toBe('1px')
	await expect(style.borderTopStyle).toBe('solid')
	await expect(style.borderTopLeftRadius).toBe('16px')
	await expect(style.boxShadow).toBe('none')
}

export const Outlined = {
	render: () =>
		defineAureliaStory({
			template: page(`
				<section class="[ card ] [ flow ]">
					<h2 class="md-typescale-title-large-emphasized">チケットの購入</h2>
					<p class="md-typescale-body-medium">枚数を選んで「次へ」を押してください。15分間チケットを確保します。</p>
				</section>`),
		}),
	play: async ({ canvasElement }) => {
		const el = card(canvasElement)
		await expectFrame(canvasElement, el)
		await expect(getComputedStyle(el).padding).toBe('16px')
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'card-outlined',
		)
	},
} satisfies Story

/**
 * A card of rows that pad themselves (Settings, passkeys): the caller sets
 * `--card-padding: 0`, and each row after the first draws a 1px
 * `outline-variant` divider.
 */
export const ListOfRows = {
	render: () =>
		defineAureliaStory({
			template: page(`
				<ul class="card" role="list" style="--card-padding: 0">
					<li class="md-typescale-body-large" style="padding:12px 16px">iPhone</li>
					<li class="md-typescale-body-large" style="padding:12px 16px; border-block-start:1px solid var(--md-sys-color-outline-variant)">MacBook Pro</li>
				</ul>`),
		}),
	play: async ({ canvasElement }) => {
		const el = card(canvasElement)
		await expectFrame(canvasElement, el)
		await expect(getComputedStyle(el).padding).toBe('0px')
		const [first, second] = Array.from(el.children) as HTMLElement[]
		// The rows reach the card's border.
		await expect(first.getBoundingClientRect().left).toBe(
			el.getBoundingClientRect().left + 1,
		)
		await expect(getComputedStyle(second).borderTopColor).toBe(
			getComputedStyle(el).borderTopColor,
		)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'card-list-of-rows',
		)
	},
} satisfies Story
