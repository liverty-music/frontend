import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'
import { expectScreenshot } from '../../.storybook/screenshot'

/**
 * Foundations story for the fan app's summary list
 * (`src/styles/summary-list.css`): key and value rows of a `<dl>`, inside the
 * `card` it summarises. Each story checks the M3 roles (key
 * `on-surface-variant`, value `on-surface`), where the value sits and the
 * space between rows; axe checks contrast on the card's fill.
 */
const meta = {
	title: 'Foundations/Summary List',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A summary inside a card on the page's surface, at a phone's width. */
function inCard(list: string): string {
	return `
		<div style="padding:1rem; inline-size:358px; box-sizing:border-box; background:var(--md-sys-color-surface)">
			<section class="[ card ] [ flow ]">${list}</section>
		</div>`
}

const row = (key: string, value: string) => `
	<div>
		<dt class="md-typescale-label-large">${key}</dt>
		<dd class="md-typescale-body-large">${value}</dd>
	</div>`

function colorOf(root: HTMLElement, value: string): string {
	const probe = document.createElement('span')
	probe.style.color = value
	root.append(probe)
	const out = getComputedStyle(probe).color
	probe.remove()
	return out
}

function list(canvasElement: HTMLElement): HTMLElement {
	const el = canvasElement.querySelector<HTMLElement>('.summary-list')
	if (!el) throw new Error('no summary list')
	return el
}

/** Key and value roles, no frame of its own, rows `gap` px apart. */
async function expectRows(
	canvasElement: HTMLElement,
	gap = 8,
): Promise<HTMLElement[]> {
	const dl = list(canvasElement)
	const style = getComputedStyle(dl)
	await expect(style.borderTopWidth).toBe('0px')
	await expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
	const variant = colorOf(
		canvasElement,
		'var(--md-sys-color-on-surface-variant)',
	)
	const surface = colorOf(canvasElement, 'var(--md-sys-color-on-surface)')
	for (const dt of dl.querySelectorAll('dt')) {
		await expect(getComputedStyle(dt).color).toBe(variant)
	}
	for (const dd of dl.querySelectorAll('dd')) {
		await expect(getComputedStyle(dd).color).toBe(surface)
	}
	const rows = Array.from(dl.children) as HTMLElement[]
	for (const [i, r] of rows.slice(1).entries()) {
		const above = rows[i].getBoundingClientRect()
		await expect(r.getBoundingClientRect().top - above.bottom).toBe(gap)
	}
	return rows
}

export const KeyValue = {
	render: () =>
		defineAureliaStory({
			template: inCard(`
				<dl class="summary-list">
					${row('席種', 'A席')}
					${row('枚数', '2枚')}
					${row('会場', 'Zepp Haneda')}
				</dl>`),
		}),
	play: async ({ canvasElement }) => {
		const rows = await expectRows(canvasElement)
		const end = list(canvasElement).getBoundingClientRect().right
		for (const r of rows) {
			const [dt, dd] = Array.from(r.children) as HTMLElement[]
			// Key at the start, value on the same line (their baselines meet),
			// ending at the end.
			await expect(dd.getBoundingClientRect().top).toBeLessThan(
				dt.getBoundingClientRect().bottom,
			)
			await expect(dd.getBoundingClientRect().left).toBeGreaterThan(
				dt.getBoundingClientRect().right,
			)
			const range = document.createRange()
			range.selectNodeContents(dd)
			await expect(
				Math.round(range.getBoundingClientRect().right),
			).toBeGreaterThanOrEqual(Math.round(end) - 1)
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'summary-list-key-value',
		)
	},
} satisfies Story

/** A value too long to sit beside its key wraps below it, at the end. */
export const LongValue = {
	render: () =>
		defineAureliaStory({
			template: inCard(`
				<dl class="summary-list">
					${row('会場', '東京ガーデンシアター（有明ガーデン内）東京都江東区有明二丁目1番6号')}
					${row('枚数', '2枚')}
				</dl>`),
		}),
	play: async ({ canvasElement }) => {
		const [long] = await expectRows(canvasElement)
		const [dt, dd] = Array.from(long.children) as HTMLElement[]
		await expect(dd.getBoundingClientRect().top).toBeGreaterThan(
			dt.getBoundingClientRect().top,
		)
		await expect(getComputedStyle(dd).textAlign).toBe('end')
		await expect(long.scrollWidth).toBeLessThanOrEqual(long.clientWidth)
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'summary-list-long-value',
		)
	},
} satisfies Story

/**
 * `data-variant="stacked"`: each value under its key, at the start, rows
 * 16px apart, for values that are sentences (the legal confirmation before a
 * purchase).
 */
export const Stacked = {
	render: () =>
		defineAureliaStory({
			template: inCard(`
				<dl class="[ summary-list ] [ md-typescale-body-medium ]" data-variant="stacked">
					<div>
						<dt class="md-typescale-body-medium-emphasized">キャンセル</dt>
						<dd>購入後のキャンセル・変更はできません。公演が中止になった場合は払い戻します。</dd>
					</div>
					<div>
						<dt class="md-typescale-body-medium-emphasized">引渡し時期</dt>
						<dd>購入後すぐにマイチケットに表示されます。</dd>
					</div>
				</dl>`),
		}),
	play: async ({ canvasElement }) => {
		const rows = await expectRows(canvasElement, 16)
		for (const r of rows) {
			const [dt, dd] = Array.from(r.children) as HTMLElement[]
			const key = dt.getBoundingClientRect()
			const value = dd.getBoundingClientRect()
			await expect(value.top).toBe(key.bottom + 4)
			await expect(value.left).toBe(key.left)
			await expect(getComputedStyle(dd).textAlign).toBe('start')
		}
		await expectScreenshot(
			canvasElement.firstElementChild ?? canvasElement,
			'summary-list-stacked',
		)
	},
} satisfies Story
