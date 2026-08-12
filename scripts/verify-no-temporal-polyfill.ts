/**
 * Post-build assertion: the production bundle ships NO TC39 Temporal polyfill.
 *
 * The `temporal-impl` plain-date engine references `globalThis.Temporal` and is
 * aliased OUT of the default build (Vite `resolve.alias` → `date-impl`), and
 * `@js-temporal/polyfill` is a devDependency used only by the differential test.
 * So the ~44 KB polyfill must never appear in `dist/`. This guard fails the
 * build if it ever does — keeping the change's bundle impact at +0 KB.
 *
 * Run via `npm run verify:no-temporal-polyfill` (wired into `make check` after
 * the build). See OpenSpec `introduce-swappable-plain-date-lib`, design D5.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { argv, exit } from 'node:process'

// Sentinels that appear in `@js-temporal/polyfill` output (as `Symbol.toStringTag`
// string literals / the package specifier) but never in this app's own code —
// our SPA only ever uses `Temporal.PlainDate` via the aliased engine. A match on
// any of these means the polyfill leaked into the bundle.
const SENTINELS = [
	'@js-temporal',
	'Temporal.ZonedDateTime',
	'Temporal.PlainYearMonth',
	'Temporal.PlainMonthDay',
]

function jsFiles(dir: string): string[] {
	const out: string[] = []
	for (const name of readdirSync(dir)) {
		const full = join(dir, name)
		if (statSync(full).isDirectory()) {
			out.push(...jsFiles(full))
		} else if (name.endsWith('.js')) {
			out.push(full)
		}
	}
	return out
}

function run(distDir: string): never {
	let files: string[]
	try {
		files = jsFiles(distDir)
	} catch {
		console.error(
			`[verify-no-temporal-polyfill] dist dir not found: ${distDir}. Did you run \`npm run build\` first?`,
		)
		exit(2)
	}
	if (files.length === 0) {
		console.error(
			`[verify-no-temporal-polyfill] no .js chunks under ${distDir} — refusing to report a false pass.`,
		)
		exit(2)
	}
	const hits: string[] = []
	for (const file of files) {
		const text = readFileSync(file, 'utf8')
		for (const sentinel of SENTINELS) {
			if (text.includes(sentinel)) hits.push(`${file} — "${sentinel}"`)
		}
	}
	if (hits.length > 0) {
		console.error(
			'[verify-no-temporal-polyfill] FAILED: Temporal polyfill code found in the production bundle:',
		)
		for (const h of hits) console.error(`  - ${h}`)
		console.error(
			'The Temporal engine must stay aliased out of the build and the polyfill must remain test-only.',
		)
		exit(1)
	}
	console.log(
		`[verify-no-temporal-polyfill] OK: scanned ${files.length} chunks, no Temporal polyfill present`,
	)
	exit(0)
}

run(argv[2] ?? 'dist')
