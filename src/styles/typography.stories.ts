import {
	defineAureliaStory,
	type Meta,
	type StoryObj,
} from '@aurelia/storybook'
import { expect } from 'storybook/test'

/**
 * The app-wide Japanese text settings (global.css): proportional widths,
 * spacing between Japanese and Latin text, strict and phrase-based line
 * breaking, and balanced headings.
 * Each check runs where the browser has the feature; the stories run in
 * Chromium, which has all but `text-autospace`.
 */
const meta = {
	title: 'Foundations/Typography',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** The lines a text node is laid out in, as the text of each line. */
function lines(el: HTMLElement): string[] {
	const text = el.firstChild
	if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('no text')
	const content = text.textContent ?? ''
	const out: string[] = []
	let top = Number.NaN
	for (let i = 0; i < content.length; i++) {
		const range = document.createRange()
		range.setStart(text, i)
		range.setEnd(text, i + 1)
		const y = Math.round(range.getBoundingClientRect().top)
		if (y !== top) {
			out.push('')
			top = y
		}
		out[out.length - 1] += content[i]
	}
	return out
}

/** A text's width as laid out in `el`'s font. */
function width(el: HTMLElement, text: string): number {
	el.textContent = text
	return el.getBoundingClientRect().width
}

export const JapaneseText = {
	render: () =>
		defineAureliaStory({
			template: `
				<div class="md-typescale-body-large" lang="ja">
					<span class="mixed" style="display: inline-block; white-space: nowrap;"></span>
					<p class="phrases" style="inline-size: 9em;">今日はとても良い天気なので公園へ散歩に行きましょう</p>
					<p class="kana" style="inline-size: 6em;">新しいアルバムのリリースパーティーがありますッ</p>
					<h2 class="md-typescale-title-large">見出しは行の長さをそろえて折り返されます</h2>
				</div>
			`,
		}),
	play: async ({ canvasElement }) => {
		await document.fonts.ready
		const root = canvasElement.querySelector<HTMLElement>('[lang="ja"]')
		if (!root) throw new Error('not rendered')

		// @spec components/infrastructure/fan/web/global/design-tokens "Text in a type style"
		// Every element inherits the settings, including one with a type style
		// class (type styles never use the `font` shorthand, which resets them).
		const style = getComputedStyle(root)
		await expect(style.fontFeatureSettings).toBe('"palt"')
		await expect(style.lineBreak).toBe('strict')
		const heading = canvasElement.querySelector<HTMLElement>('h2')
		if (!heading) throw new Error('no heading')
		await expect(getComputedStyle(heading).fontFeatureSettings).toBe('"palt"')

		// @spec components/infrastructure/fan/web/global/design-tokens "Mixed Japanese and Latin text"
		const mixed = canvasElement.querySelector<HTMLElement>('.mixed')
		if (!mixed) throw new Error('no mixed text')
		if (CSS.supports('text-autospace: normal')) {
			const joined = width(mixed, 'Tokyo公演')
			const apart = width(mixed, 'Tokyo') + width(mixed, '公演')
			const space = joined - apart
			// A gap, narrower than a full (1em) space.
			await expect(space).toBeGreaterThan(0.5)
			await expect(space).toBeLessThan(
				Number.parseFloat(getComputedStyle(mixed).fontSize),
			)
		} else {
			await expect(style.getPropertyValue('text-autospace')).toBe('')
		}

		// @spec components/infrastructure/fan/web/global/design-tokens "A phrase is not split"
		const phrases = canvasElement.querySelector<HTMLElement>('.phrases')
		if (!phrases) throw new Error('no sentence')
		if (CSS.supports('word-break: auto-phrase')) {
			await expect(getComputedStyle(phrases).wordBreak).toBe('auto-phrase')
			const words = [
				'今日は',
				'とても',
				'良い',
				'天気なので',
				'公園へ',
				'散歩に',
				'行きましょう',
			]
			const laidOut = lines(phrases)
			await expect(laidOut.length).toBeGreaterThan(1)
			// Every line is made of whole phrases.
			for (const line of laidOut) {
				let rest = line
				while (rest.length > 0) {
					const word = words.find((w) => rest.startsWith(w))
					await expect(word, `"${line}" splits a phrase`).toBeDefined()
					rest = rest.slice(word?.length ?? rest.length)
				}
			}
		}

		// @spec components/infrastructure/fan/web/global/design-tokens "Small kana at the start of a line"
		const kana = canvasElement.querySelector<HTMLElement>('.kana')
		if (!kana) throw new Error('no kana text')
		const starts = lines(kana).map((l) => l[0])
		await expect(starts.length).toBeGreaterThan(2)
		for (const first of starts.slice(1)) {
			await expect('ぁぃぅぇぉっゃゅょァィゥェォッャュョー').not.toContain(
				first,
			)
		}

		await expect(getComputedStyle(heading).textWrap).toContain('balance')
	},
} satisfies Story
