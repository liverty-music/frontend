// @vitest-environment node

import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The Material 3 window size class boundaries, in px. */
const BREAKPOINTS = new Set([600, 840, 1200, 1600])

/**
 * Window-width conditions in the fan app's stylesheets: every `@media` query
 * on the width of the window, with the widths it names. (`@container` queries
 * are a component adapting to its own container and are free to use other
 * widths; stylelint cannot tell the two apart by value, so this reads them.)
 */
function windowWidthQueries(): { file: string; query: string; px: number[] }[] {
	const found: { file: string; query: string; px: number[] }[] = []
	for (const file of globSync('src/**/*.css')) {
		const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
		for (const match of css.matchAll(/@media\s+([^{]+)\{/g)) {
			const query = match[1].trim()
			if (!/\b(min-|max-)?width\b/.test(query)) continue
			const px = [...query.matchAll(/(\d+(?:\.\d+)?)px/g)]
				.filter(
					(m) =>
						!/height/.test(query.slice(Math.max(0, m.index - 14), m.index)),
				)
				.map((m) => Number(m[1]))
			found.push({ file, query, px })
		}
	}
	return found
}

describe('window-width layout breakpoints (fan)', () => {
	// Guards the fan half of "Window width crosses a breakpoint" only as far as a
	// stylesheet scan can: no fan screen changes layout by window width today,
	// so the scenario's WHEN has nothing to run against (see the organizer story).
	it('changes layout only at the Material 3 breakpoints', () => {
		const off = windowWidthQueries()
			.flatMap(({ file, query, px }) =>
				px.filter((w) => !BREAKPOINTS.has(w)).map(() => `${file}: ${query}`),
			)
			.sort()

		// The two SE-class phone rules combine the window's width with its height
		// (a container query cannot), each carrying a stylelint-disable with that
		// reason. Nothing else may leave the breakpoints.
		expect(off).toEqual([
			'src/components/page-header/page-header.css: (height <= 700px) and (width < 390px)',
			'src/routes/discovery/discovery-route.css: (height <= 700px) and (width < 390px)',
		])
	})
})
