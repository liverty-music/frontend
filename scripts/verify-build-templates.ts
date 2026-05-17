/**
 * Post-build assertion entry. Delegates the work to
 * `verify-build-templates.lib.ts` (which is pure and testable) and maps
 * the returned result to console output + exit code.
 *
 * Run via `npm run verify:build-templates` (wired into the Dockerfile
 * RUN that follows `npm run build`, and the post-deploy CI workflow).
 */

import { argv, exit } from 'node:process'
import { checkBuildTemplates } from './verify-build-templates.lib'

function run(distDir: string): never {
	const result = checkBuildTemplates(distDir)
	switch (result.kind) {
		case 'missing-assets':
			console.error(
				`[verify-build-templates] assets directory not found: ${result.assetsDir}. Did you run \`npm run build\` first?`,
			)
			exit(2)
		case 'failed':
			console.error('[verify-build-templates] FAILED:')
			for (const f of result.failures) console.error(`  - ${f}`)
			exit(1)
		case 'ok':
			console.log(
				`[verify-build-templates] OK: all ${result.checked} route chunks contain expected template markers`,
			)
			exit(0)
	}
}

run(argv[2] ?? 'dist')
