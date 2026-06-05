// @vitest-environment node
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkBundleIsolation } from './verify-bundle-isolation.lib'

/**
 * Builds a synthetic `dist/` mirroring the real two-entry layout: a consumer
 * `index.html` whose entry chunk statically/dynamically imports route chunks,
 * and an `assets/admin/` subtree for admin-exclusive chunks (the real build
 * routes them there via vite.config.ts).
 */
function scaffold(
	distDir: string,
	files: Record<string, string>,
	indexHtml: string,
): void {
	mkdirSync(join(distDir, 'assets', 'admin'), { recursive: true })
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(distDir, rel)
		mkdirSync(join(abs, '..'), { recursive: true })
		writeFileSync(abs, content)
	}
	writeFileSync(join(distDir, 'index.html'), indexHtml)
}

describe('checkBundleIsolation', () => {
	let workDir: string

	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), 'verify-bundle-isolation-'))
	})

	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true })
	})

	it('returns missing-entry when index.html is absent', () => {
		const result = checkBundleIsolation(workDir)
		assert(result.kind === 'missing-entry')
		expect(result.entryHtml).toBe(join(workDir, 'index.html'))
	})

	it('returns no-seeds (fails closed) when index.html references no entry chunk', () => {
		// index.html present but its entry-script reference no longer matches the
		// seed regex (e.g. a build/output shape change). The walk would be empty;
		// the gate must refuse to report success rather than pass vacuously.
		scaffold(
			workDir,
			{ 'assets/main-AAAA.js': '// orphan chunk, never referenced' },
			'<div>no script tag the seed regex can match</div>',
		)
		const result = checkBundleIsolation(workDir)
		assert(result.kind === 'no-seeds')
		expect(result.entryHtml).toBe(join(workDir, 'index.html'))
	})

	it('returns ok when the consumer graph references no admin chunk', () => {
		scaffold(
			workDir,
			{
				'assets/main-AAAA.js':
					'import"./welcome-route-BBBB.js";import"./shared-CCCC.js"',
				'assets/welcome-route-BBBB.js': '// welcome',
				'assets/shared-CCCC.js': '// shared chunk (also used by admin)',
				// Admin-exclusive chunk exists in dist but is NOT reachable from
				// the consumer entry — must be ignored.
				'assets/admin/welcome-route-DDDD.js': 'import"../shared-CCCC.js"',
			},
			'<script src="/assets/main-AAAA.js"></script>',
		)
		const result = checkBundleIsolation(workDir)
		assert(result.kind === 'ok')
		expect(result.checked).toBeGreaterThan(0)
	})

	it('flags a leak when the consumer statically imports an assets/admin chunk', () => {
		scaffold(
			workDir,
			{
				'assets/main-AAAA.js': 'import"./admin/welcome-route-DDDD.js"',
				'assets/admin/welcome-route-DDDD.js': '// admin only',
			},
			'<script src="/assets/main-AAAA.js"></script>',
		)
		const result = checkBundleIsolation(workDir)
		assert(result.kind === 'leaked')
		expect(result.leaks).toContain('assets/admin/welcome-route-DDDD.js')
	})

	it('flags a leak when the consumer dynamically imports the admin entry chunk', () => {
		scaffold(
			workDir,
			{
				'assets/main-AAAA.js': 'const x=()=>import("./admin-EEEE.js")',
				'assets/admin-EEEE.js': '// admin entry',
			},
			'<script src="/assets/main-AAAA.js"></script>',
		)
		const result = checkBundleIsolation(workDir)
		assert(result.kind === 'leaked')
		expect(result.leaks).toContain('assets/admin-EEEE.js')
	})

	it('flags a leak reached transitively through a shared chunk', () => {
		scaffold(
			workDir,
			{
				'assets/main-AAAA.js': 'import"./mid-FFFF.js"',
				'assets/mid-FFFF.js': 'import"./admin/leak-GGGG.js"',
				'assets/admin/leak-GGGG.js': '// admin only',
			},
			'<script src="/assets/main-AAAA.js"></script>',
		)
		const result = checkBundleIsolation(workDir)
		assert(result.kind === 'leaked')
		expect(result.leaks).toContain('assets/admin/leak-GGGG.js')
	})
})
