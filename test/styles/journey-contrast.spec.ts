import { describe, expect, it } from 'vitest'
import chipCss from '../../src/components/artist-filter-bar/artist-filter-bar.css?raw'
import sheetCss from '../../src/components/live-highway/event-detail-sheet.css?raw'
import tokensCss from '../../src/styles/tokens.css?raw'
import { contrast, type Oklch, parseOklch } from '../helpers/oklch'

/**
 * Every filled ticket-journey status keeps its label at 4.5:1 (body text, WCAG
 * 1.4.3). Each control fills with `oklch(L C var(--journey-hue-*))`; the test
 * resolves the hue from the tokens and computes the contrast without a browser.
 */

const STATUSES = ['tracking', 'applied', 'unpaid', 'paid', 'lost'] as const

function journeyHue(status: string): number {
	const m = tokensCss.match(
		new RegExp(`--journey-hue-${status}\\s*:\\s*([\\d.]+)deg`),
	)
	if (!m) throw new Error(`--journey-hue-${status} is not a literal hue`)
	return Number(m[1])
}

/** `prop: oklch(L C var(...))` in `block`, with the hue filled in. */
function hued(block: string, prop: string, hue: number): Oklch {
	const m = block.match(
		new RegExp(`${prop}:\\s*oklch\\(([\\d.]+%)\\s+([\\d.]+)\\s+var`),
	)
	if (!m) throw new Error(`no ${prop} oklch() in the block`)
	return parseOklch(`oklch(${m[1]} ${m[2]} ${hue}deg)`)
}

/** The declarations of the first rule whose selector list names `selector`. */
function ruleOf(css: string, selector: string): string {
	const start = css.indexOf(selector)
	if (start === -1) throw new Error(`no rule for ${selector}`)
	return css.slice(css.indexOf('{', start), css.indexOf('}', start))
}

describe('ticket journey labels', () => {
	for (const status of STATUSES) {
		it(`the current ${status} node in the detail sheet reaches 4.5:1`, () => {
			const block = ruleOf(
				sheetCss,
				`.journey-node[data-journey-status="${status}"]`,
			)
			const hue = journeyHue(status)
			expect(
				contrast(
					hued(block, '--_node-on', hue),
					hued(block, '--_node-fill', hue),
				),
			).toBeGreaterThanOrEqual(4.5)
		})

		it(`a selected ${status} filter chip reaches 4.5:1`, () => {
			const block = ruleOf(
				chipCss.slice(chipCss.indexOf('.journey-chip {')),
				'&:has(input:checked)',
			)
			expect(block).toContain('color: var(--color-white)')
			expect(
				contrast(
					parseOklch('oklch(100% 0 0deg)'),
					hued(block, 'background', journeyHue(status)),
				),
			).toBeGreaterThanOrEqual(4.5)
		})
	}
})
