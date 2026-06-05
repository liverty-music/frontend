/**
 * Post-build assertion entry. Delegates to `verify-bundle-isolation.lib.ts`
 * (pure, testable) and maps the result to console output + exit code.
 *
 * Run via `npm run verify:bundle-isolation` (wired into the consumer Dockerfile
 * after `npm run build`, and into `make check`). Fails the build if the
 * consumer entry (index.html) chunk graph references any admin-origin module
 * (OpenSpec change `add-admin-console`, design D2 bundle-isolation requirement).
 */

import { argv, exit } from 'node:process'
import { checkBundleIsolation } from './verify-bundle-isolation.lib'

function run(distDir: string): never {
	const result = checkBundleIsolation(distDir)
	switch (result.kind) {
		case 'missing-entry':
			console.error(
				`[verify-bundle-isolation] consumer entry not found: ${result.entryHtml}. Did you run \`npm run build\` first?`,
			)
			exit(2)
		case 'no-seeds':
			console.error(
				`[verify-bundle-isolation] no entry chunks found in ${result.entryHtml}. The isolation walk would be empty (false pass) — the build output shape likely changed. Refusing to report success.`,
			)
			exit(2)
		case 'leaked':
			console.error(
				'[verify-bundle-isolation] FAILED: consumer entry graph references admin-origin chunks:',
			)
			for (const l of result.leaks) console.error(`  - ${l}`)
			console.error(
				'The consumer SPA must not load any module from admin/. Check for a stray src/ -> admin/ import.',
			)
			exit(1)
		case 'ok':
			console.log(
				`[verify-bundle-isolation] OK: walked ${result.checked} consumer chunks, no admin-origin module reachable`,
			)
			exit(0)
	}
}

run(argv[2] ?? 'dist')
