/**
 * Post-build assertion entry for the reception app. Delegates to
 * `verify-reception-bundle.lib.ts` (pure, testable) and maps the result to
 * console output + exit code.
 *
 * Run via `npm run verify:reception-bundle` after `npm run build:reception`
 * (wired into `make check`, CI and Dockerfile.reception). Fails when
 * `dist-reception/` contains the OIDC client or console code, and reports the
 * output size (OpenSpec change `isolate-venue-reception`, design D4).
 */

import { argv, exit } from 'node:process'
import { checkReceptionBundle } from './verify-reception-bundle.lib'

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`

function run(distDir: string): never {
	const result = checkReceptionBundle(distDir)
	switch (result.kind) {
		case 'missing-entry':
			console.error(
				`[verify-reception-bundle] reception entry not found: ${result.entryHtml}. Did you run \`npm run build:reception\` first?`,
			)
			exit(2)
		case 'not-reception':
			console.error(
				`[verify-reception-bundle] ${result.distDir} does not contain the reception app (no reception-shell). Refusing to report success.`,
			)
			exit(2)
		case 'leaked':
			console.error(
				'[verify-reception-bundle] FAILED: the reception output contains code it must not ship:',
			)
			for (const f of result.findings) console.error(`  - ${f}`)
			console.error(
				'The reception app must not import organizer/, admin/, src/ or shared/services/auth-service (see .dependency-cruiser.cjs).',
			)
			exit(1)
		case 'ok':
			console.log('[verify-reception-bundle] output files:')
			for (const f of result.files) {
				console.log(
					`  ${f.path.padEnd(48)} ${kb(f.bytes).padStart(11)}  gzip ${kb(f.gzipBytes).padStart(11)}`,
				)
			}
			console.log(
				`[verify-reception-bundle] OK: no OIDC client or console code in ${result.files.length} files; total ${kb(result.totalBytes)} (gzip ${kb(result.totalGzipBytes)})`,
			)
			exit(0)
	}
}

run(argv[2] ?? 'dist-reception')
