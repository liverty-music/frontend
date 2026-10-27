import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = join(__dirname, '../../src/routes/discovery')
const html = readFileSync(join(DIR, 'discovery-route.html'), 'utf8')
const css = readFileSync(join(DIR, 'discovery-route.css'), 'utf8')
const swapCss = readFileSync(join(DIR, 'discovery-swap.css'), 'utf8')

/** The rows of the `.discovery-layout` grid, top to bottom. */
function layoutRows(): string[] {
	const block = css.match(/\.discovery-layout \{[\s\S]*?grid-template:([^;]+);/)
	if (!block) throw new Error('discovery-layout grid-template not found')
	return [...block[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1])
}

describe('Discovery layout', () => {
	// @spec components/infrastructure/fan/web/route/discovery "The row never overlaps the bubble field"
	it('gives the progress row its own grid row above the bubble area, outside it', () => {
		expect(layoutRows()).toEqual(['search', 'genre', 'progress', 'bubbles'])
		expect(css).toMatch(/\.progress-row \{\s*grid-area: progress;/)

		const progress = html.indexOf('<onboarding-progress')
		const bubbles = html.indexOf('<div class="bubble-area">')
		const bubblesEnd = html.indexOf('</dna-orb-canvas>')
		expect(progress).toBeGreaterThan(-1)
		// A sibling before the bubble area, never inside it with the canvas.
		expect(progress).toBeLessThan(bubbles)
		expect(bubblesEnd).toBeGreaterThan(bubbles)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Search bar display"
	it('puts the search bar in the top row', () => {
		expect(layoutRows()[0]).toBe('search')
		expect(css).toMatch(/\.search-bar \{[\s\S]*?grid-area: search;/)
		expect(html).toMatch(/<search class="search-bar">/)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Search mode"
	it('hides the swap tile with the genre chips while searching', () => {
		const tile = html.indexOf('<discovery-swap-button')
		expect(html.lastIndexOf('<main', tile)).toBeGreaterThan(-1)
		expect(html).toMatch(
			/<main [^>]*data-search-mode\.bind="search\.isSearchMode"/,
		)
		expect(swapCss).toMatch(
			/\.discovery-layout\[data-search-mode="true"\] \.swap-tile-slot \{\s*display: none;/,
		)
		expect(css).toMatch(
			/\.discovery-layout\[data-search-mode="true"\] :is\(\.genre-bar, \.bubble-area\) \{\s*display: none;/,
		)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Left-handed mode"
	it('mirrors the swap tile to the left of the orb in left-handed mode', () => {
		expect(html).toMatch(
			/<discovery-swap-button[^>]*data-handed\.bind="fabMenu\.handed"/,
		)
		expect(swapCss).toMatch(
			/\.swap-tile-slot \{[\s\S]*?place-self: end start;[\s\S]*?margin-inline-start: calc\(50% \+ var\(--orb-max-r\) \+ var\(--space-s\)\);/,
		)
		expect(swapCss).toMatch(
			/\.swap-tile-slot\[data-handed="left"\] \{\s*justify-self: end;\s*margin-inline: 0 calc\(50% \+ var\(--orb-max-r\) \+ var\(--space-s\)\);/,
		)
	})
})
