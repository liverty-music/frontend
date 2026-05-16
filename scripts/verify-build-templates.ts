/**
 * Post-build assertion: every lazy route chunk MUST contain a known
 * template-derived marker string. Guards against the v1.0.0 regression
 * class in which a build-time misconfiguration silently strips compiled
 * HTML templates from chunks, producing a bundle that loads but cannot
 * resolve any route.
 *
 * Adding a route: register it here with a stable class name or other
 * template-derived literal from its `.html` file. The literal must NOT
 * appear in the corresponding `.ts` file (so we know it survived only
 * via template compilation).
 *
 * Run via `npm run verify:build-templates` (wired into CI).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { argv, exit } from 'node:process'

interface RouteMarker {
	route: string
	marker: string
}

const ROUTE_MARKERS: readonly RouteMarker[] = [
	{ route: 'welcome', marker: 'welcome-brand' },
	{ route: 'about', marker: 'about-title' },
	{ route: 'auth-callback', marker: 'callback-loading' },
	{ route: 'dashboard', marker: 'loading-text' },
	{ route: 'discovery', marker: 'search-bar' },
	{ route: 'import-ticket-email', marker: 'import-wizard' },
	{ route: 'my-artists', marker: 'state-center' },
	{ route: 'not-found', marker: 'not-found-code' },
	{ route: 'settings', marker: 'settings-section-title' },
	{ route: 'tickets', marker: 'state-center' },
]

function findChunk(assetsDir: string, route: string): string | null {
	const prefix = `${route}-route-`
	const entries = readdirSync(assetsDir).filter(
		(f) => f.startsWith(prefix) && f.endsWith('.js'),
	)
	if (entries.length === 0) return null
	if (entries.length > 1) {
		console.warn(
			`[verify-build-templates] multiple chunks for ${route}: ${entries.join(', ')}; using first`,
		)
	}
	return join(assetsDir, entries[0])
}

function main(): void {
	const distDir = argv[2] ?? 'dist'
	const assetsDir = join(distDir, 'assets')

	if (!existsSync(assetsDir)) {
		console.error(
			`[verify-build-templates] assets directory not found: ${assetsDir}. Did you run \`npm run build\` first?`,
		)
		exit(2)
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
				`route '${route}': chunk ${chunkPath} does not contain marker '${marker}'. Template stripping suspected — see OpenSpec change \`adopt-runtime-config-for-frontend\` design D10.`,
			)
		}
	}

	if (failures.length > 0) {
		console.error('[verify-build-templates] FAILED:')
		for (const f of failures) console.error(`  - ${f}`)
		exit(1)
	}

	console.log(
		`[verify-build-templates] OK: all ${ROUTE_MARKERS.length} route chunks contain expected template markers`,
	)
}

main()
