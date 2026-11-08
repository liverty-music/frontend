import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Text with the same role takes the same type style on every screen. The
 * step titles of the three purchase flows are the case the design-tokens spec
 * names; they are read from the templates, where the type style is given.
 */

const CAPABILITY = 'components/infrastructure/fan/web/global/design-tokens'

/** The type style classes on elements carrying `cls` in a template. */
function typeStyles(template: string, cls: string): string[] {
	const html = readFileSync(template, 'utf8')
	return [...html.matchAll(/class="([^"]*)"/g)]
		.map((m) => m[1].replace(/[[\]]/g, ' ').split(/\s+/))
		.filter((classes) => classes.includes(cls))
		.map((classes) =>
			classes.filter((c) => c.startsWith('md-typescale-')).join(' '),
		)
}

describe('type roles', () => {
	it(`@spec ${CAPABILITY} "Same role, same look"`, () => {
		const steps = [
			typeStyles(
				'src/routes/checkout/checkout-route.html',
				'checkout-step-title',
			),
			typeStyles(
				'src/routes/lottery-entry/lottery-entry-route.html',
				'lottery-entry-step-title',
			),
			typeStyles(
				'src/routes/resale-entry/resale-entry-route.html',
				'resale-entry-step-title',
			),
		]
		for (const screen of steps) expect(screen.length).toBeGreaterThan(0)
		expect(new Set(steps.flat())).toEqual(
			new Set(['md-typescale-title-large-emphasized']),
		)
	})
})
