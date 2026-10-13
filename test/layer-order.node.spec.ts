import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Each HTML entry declares its cascade layer order before any stylesheet, the
 * same order its main CSS declares. Vite links CSS chunks shared between
 * entries before the entry's own CSS, and the first `@layer` the browser reads
 * fixes the order, so without this a shared component's `block` layer ranks
 * below `reset` and `global` (fan web v1.89.0 rendered without component
 * styles).
 */

const ENTRIES = {
	'index.html': 'src/styles/main.css',
	'organizer.html': 'organizer/styles/main.css',
	'admin.html': 'admin/styles/main.css',
} as const

const LAYER_STATEMENT = /@layer\s+([a-z-]+(?:\s*,\s*[a-z-]+)+)\s*;/

function layers(text: string): string[] | undefined {
	return text
		.match(LAYER_STATEMENT)?.[1]
		.split(',')
		.map((name) => name.trim())
}

describe('cascade layer order', () => {
	for (const [html, css] of Object.entries(ENTRIES)) {
		it(`${html} declares the layer order of ${css} before any stylesheet`, () => {
			const page = readFileSync(html, 'utf8')
			const head = page.slice(0, page.indexOf('</head>'))
			const statement = head.search(LAYER_STATEMENT)
			const firstStylesheet = head.search(
				/<link[^>]+rel="stylesheet"|<style>(?!\s*@layer)/,
			)

			expect(statement).toBeGreaterThan(-1)
			expect(firstStylesheet === -1 || statement < firstStylesheet).toBe(true)
			expect(layers(head)).toEqual(layers(readFileSync(css, 'utf8')))
		})
	}
})
