/**
 * Entry point for the route-loading assertion. Delegates to the pure
 * `verify-route-loading.lib.ts` and maps its result to console output and an
 * exit code.
 *
 * Run via `npm run verify:route-loading` (wired into `make lint`).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { exit } from 'node:process'
import { checkRouteLoading } from './verify-route-loading.lib'

function routeFiles(dir: string): { path: string; source: string }[] {
	const out: { path: string; source: string }[] = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			out.push(...routeFiles(full))
		} else if (entry.endsWith('-route.ts') && !entry.endsWith('.spec.ts')) {
			out.push({ path: full, source: readFileSync(full, 'utf8') })
		}
	}
	return out
}

const result = checkRouteLoading(routeFiles('src/routes'))

if (result.kind === 'failed') {
	console.error('[verify-route-loading] FAILED:')
	for (const f of result.failures) {
		console.error(`  ${f.path ?? f.file}:${f.line}  ${f.kind}`)
		console.error(`    ${f.detail}`)
	}
	exit(1)
}

console.log(`[verify-route-loading] OK — ${result.checked} route(s) checked.`)
