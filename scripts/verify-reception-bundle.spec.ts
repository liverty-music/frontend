// @vitest-environment node
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkReceptionBundle } from './verify-reception-bundle.lib'

/** Builds a synthetic `dist-reception/` from relative paths and contents. */
function scaffold(distDir: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(distDir, rel)
		mkdirSync(join(abs, '..'), { recursive: true })
		writeFileSync(abs, content)
	}
}

const CLEAN = {
	'reception.html':
		'<script type="module" src="/assets/reception-A.js"></script><reception-shell></reception-shell>',
	'assets/reception-A.js':
		'const n="reception-shell";import("./reception-route-B.js")',
	'assets/reception-route-B.js': 'const n="reception-route";',
	'config.json': '{"environment":"prod"}',
}

describe('checkReceptionBundle', () => {
	let workDir: string

	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), 'verify-reception-bundle-'))
	})

	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true })
	})

	it('returns missing-entry when reception.html is absent', () => {
		const result = checkReceptionBundle(workDir)
		assert(result.kind === 'missing-entry')
		expect(result.entryHtml).toBe(join(workDir, 'reception.html'))
	})

	it('returns ok with the measured files for a clean reception output', () => {
		scaffold(workDir, CLEAN)
		const result = checkReceptionBundle(workDir)
		assert(result.kind === 'ok')
		expect(result.files.map((f) => f.path)).toEqual([
			'assets/reception-A.js',
			'assets/reception-route-B.js',
			'config.json',
			'reception.html',
		])
		expect(result.totalBytes).toBe(
			result.files.reduce((n, f) => n + f.bytes, 0),
		)
		expect(result.totalGzipBytes).toBeGreaterThan(0)
	})

	it('fails closed when the output is not the reception app', () => {
		scaffold(workDir, {
			'reception.html': '<script src="/assets/x.js"></script>',
			'assets/x.js': 'console.log(1)',
		})
		expect(checkReceptionBundle(workDir).kind).toBe('not-reception')
	})

	it('reports the OIDC client', () => {
		scaffold(workDir, {
			...CLEAN,
			'assets/reception-A.js':
				'const n="reception-shell";class X{signinRedirect(){}}',
		})
		const result = checkReceptionBundle(workDir)
		assert(result.kind === 'leaked')
		expect(result.findings).toEqual([
			'assets/reception-A.js: OIDC client ("signinRedirect")',
		])
	})

	it('reports the console sign-in service', () => {
		scaffold(workDir, {
			...CLEAN,
			'assets/auth-C.js': 'const s="urn:zitadel:iam:org:id:"',
		})
		const result = checkReceptionBundle(workDir)
		assert(result.kind === 'leaked')
		expect(result.findings).toEqual([
			'assets/auth-C.js: OIDC client ("urn:zitadel")',
		])
	})

	it('reports console code and files of other entries', () => {
		scaffold(workDir, {
			...CLEAN,
			'assets/organizer/concerts-route-D.js': 'const n="concerts-route";',
			'index.html': '<app-shell></app-shell>',
		})
		const result = checkReceptionBundle(workDir)
		assert(result.kind === 'leaked')
		expect(result.findings).toEqual([
			"assets/organizer/concerts-route-D.js: file of another entry's build",
			'assets/organizer/concerts-route-D.js: console code ("concerts-route")',
			"index.html: file of another entry's build",
			'index.html: console code ("app-shell")',
		])
	})

	it('does not scan binary files for markers', () => {
		scaffold(workDir, {
			...CLEAN,
			'assets/zxing_reader-E.wasm': 'signinRedirect',
		})
		expect(checkReceptionBundle(workDir).kind).toBe('ok')
	})
})
