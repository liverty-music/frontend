/**
 * Pure library used by `verify-build-templates.ts`. Exposes the route →
 * marker contract and a `checkBuildTemplates(distDir)` function that
 * returns a structured result (success / failures) instead of calling
 * `process.exit()`. Splitting this out makes the assertion logic
 * unit-testable against a synthetic `dist/` directory without spawning
 * subprocesses.
 *
 * Adding a route: register it in `ROUTE_MARKERS` with a stable class
 * name or other template-derived literal from its `.html` file. The
 * literal must NOT appear in the corresponding `.ts` file (so we know
 * it survived only via template compilation).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RouteMarker {
	readonly route: string
	readonly marker: string
}

export const ROUTE_MARKERS: readonly RouteMarker[] = [
	{ route: 'welcome', marker: 'welcome-brand' },
	{ route: 'about', marker: 'about-title' },
	{ route: 'auth-callback', marker: 'callback-loading' },
	{ route: 'dashboard', marker: 'loading-text' },
	{ route: 'discovery', marker: 'search-bar' },
	{ route: 'import-ticket-email', marker: 'import-wizard' },
	{ route: 'my-artists', marker: 'artists-fieldset' },
	{ route: 'not-found', marker: 'not-found-code' },
	{ route: 'settings', marker: 'settings-section-title' },
	{ route: 'tickets', marker: 'ticket-row' },
]

export type CheckResult =
	| { kind: 'ok'; checked: number }
	| { kind: 'missing-assets'; assetsDir: string }
	| { kind: 'failed'; failures: readonly string[] }

function findChunk(assetsDir: string, route: string): string | null {
	const prefix = `${route}-route-`
	const entries = readdirSync(assetsDir).filter(
		(f) => f.startsWith(prefix) && f.endsWith('.js'),
	)
	if (entries.length === 0) return null
	return join(assetsDir, entries[0])
}

/**
 * Inspects the built `dist/assets/` directory and returns a structured
 * result indicating whether every known route chunk contains its
 * template-derived marker.
 *
 * Pure (no process.exit, no console writes) — call sites are
 * responsible for surfacing the result.
 */
export function checkBuildTemplates(distDir: string): CheckResult {
	const assetsDir = join(distDir, 'assets')
	if (!existsSync(assetsDir)) {
		return { kind: 'missing-assets', assetsDir }
	}

	const failures: string[] = []
	for (const { route, marker } of ROUTE_MARKERS) {
		const chunkPath = findChunk(assetsDir, route)
		if (!chunkPath) {
			failures.push(`route '${route}': no chunk found in ${assetsDir}`)
			continue
		}
		const content = readFileSync(chunkPath, 'utf-8')
		if (!content.includes(marker)) {
			failures.push(
				`route '${route}': chunk ${chunkPath} does not contain marker '${marker}'. Template stripping suspected — see OpenSpec archive \`2026-05-16-adopt-runtime-config-for-frontend\` design D10.`,
			)
		}
	}

	if (failures.length > 0) return { kind: 'failed', failures }
	return { kind: 'ok', checked: ROUTE_MARKERS.length }
}
