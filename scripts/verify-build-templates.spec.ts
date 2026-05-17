// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	checkBuildTemplates,
	ROUTE_MARKERS,
} from './verify-build-templates.lib'

/**
 * Populates a synthetic dist/assets directory with one chunk per route.
 * Each chunk's contents are caller-supplied (defaults to a string that
 * includes the route's expected marker, so the default scaffold is a
 * "valid" build).
 */
function scaffoldDist(
	distDir: string,
	overrides: Partial<Record<string, string>> = {},
): void {
	const assetsDir = join(distDir, 'assets')
	mkdirSync(assetsDir, { recursive: true })
	for (const { route, marker } of ROUTE_MARKERS) {
		const content = overrides[route] ?? `// marker:${marker}`
		writeFileSync(join(assetsDir, `${route}-route-XXXX.js`), content)
	}
}

describe('checkBuildTemplates', () => {
	let workDir: string

	beforeEach(() => {
		workDir = mkdtempSync(join(tmpdir(), 'verify-build-templates-'))
	})

	afterEach(() => {
		rmSync(workDir, { recursive: true, force: true })
	})

	it('returns missing-assets when dist/assets is absent', () => {
		const result = checkBuildTemplates(workDir)
		expect(result.kind).toBe('missing-assets')
		if (result.kind === 'missing-assets') {
			expect(result.assetsDir).toBe(join(workDir, 'assets'))
		}
	})

	it('returns ok when every route chunk contains its marker', () => {
		scaffoldDist(workDir)
		const result = checkBuildTemplates(workDir)
		expect(result.kind).toBe('ok')
		if (result.kind === 'ok') {
			expect(result.checked).toBe(ROUTE_MARKERS.length)
		}
	})

	it('returns failed when a chunk is missing for a route', () => {
		scaffoldDist(workDir)
		// Remove the welcome chunk so it has no entry in dist/assets.
		rmSync(join(workDir, 'assets', `welcome-route-XXXX.js`))
		const result = checkBuildTemplates(workDir)
		expect(result.kind).toBe('failed')
		if (result.kind === 'failed') {
			expect(result.failures).toHaveLength(1)
			expect(result.failures[0]).toMatch(/welcome.*no chunk found/)
		}
	})

	it('returns failed when a chunk is present but missing its marker', () => {
		scaffoldDist(workDir, { welcome: '// nothing meaningful here' })
		const result = checkBuildTemplates(workDir)
		expect(result.kind).toBe('failed')
		if (result.kind === 'failed') {
			expect(result.failures).toHaveLength(1)
			expect(result.failures[0]).toMatch(
				/welcome.*does not contain marker 'welcome-brand'/,
			)
		}
	})

	it('reports every failing route in a single pass', () => {
		scaffoldDist(workDir, {
			welcome: '// blank',
			dashboard: '// blank too',
		})
		const result = checkBuildTemplates(workDir)
		expect(result.kind).toBe('failed')
		if (result.kind === 'failed') {
			expect(result.failures).toHaveLength(2)
			expect(result.failures.some((f) => f.includes('welcome'))).toBe(true)
			expect(result.failures.some((f) => f.includes('dashboard'))).toBe(true)
		}
	})

	it('shape: ROUTE_MARKERS entries are well-formed and unique', () => {
		// Local consistency only: each entry has a kebab-case route slug,
		// a non-empty marker, and the route slug does not duplicate
		// another entry. This does NOT verify alignment with
		// `src/app-shell.ts` — adding a new route to app-shell.ts
		// without updating ROUTE_MARKERS will silently skip that
		// route in the post-build assertion. Keeping the two in sync is
		// a contributor checklist item (see `frontend/docs/runtime-config.md`
		// once that follow-up lands; tracked in liverty-music/specification#491).
		const routes = new Set<string>()
		for (const { route, marker } of ROUTE_MARKERS) {
			expect(route).toMatch(/^[a-z][a-z-]+$/)
			expect(marker.length).toBeGreaterThan(0)
			expect(routes.has(route)).toBe(false)
			routes.add(route)
		}
	})
})
