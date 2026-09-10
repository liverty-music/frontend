import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Reduced-motion contract (interaction-feedback spec: "Every animation has a
 * reduced-motion path"). Any stylesheet that drives motion with an M3 spring
 * token — `var(--md-spring-*)` used in a `transition`/`animation` — MUST also
 * carry a `prefers-reduced-motion: reduce` branch so the spring is neutralized
 * (or lands its end state) for motion-sensitive users.
 *
 * Scoped to spring-token USE (`var(--md-spring-`), so `tokens.css` (which only
 * DEFINES the tokens) is not flagged. Runs in the Node `scripts` Vitest project
 * so it executes under `make test` / CI — unlike a Docker-build-only guard, it
 * is visible where developers already run tests.
 */
function findCssFiles(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue
			out.push(...findCssFiles(full))
		} else if (entry.name.endsWith('.css')) {
			out.push(full)
		}
	}
	return out
}

describe('reduced-motion contract', () => {
	it('every stylesheet using a spring token has a prefers-reduced-motion fallback', () => {
		const offenders = findCssFiles('src').filter((file) => {
			const css = readFileSync(file, 'utf-8')
			return (
				css.includes('var(--md-spring-') &&
				!css.includes('prefers-reduced-motion')
			)
		})

		expect(
			offenders,
			`These stylesheets animate with an M3 spring token but have no ` +
				`\`prefers-reduced-motion: reduce\` branch (interaction-feedback spec):\n` +
				offenders.map((f) => `  - ${f}`).join('\n'),
		).toEqual([])
	})
})
