// @vitest-environment node
import { strict as assert } from 'node:assert'
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
		// node:assert narrows the type AND fails loudly — vitest's
		// `expect(result.kind).toBe(...)` followed by an `if`-guard would
		// silently skip inner assertions when the outer expectation fails.
		assert.equal(result.kind, 'missing-assets')
		assert(result.kind === 'missing-assets')
		expect(result.assetsDir).toBe(join(workDir, 'assets'))
	})

	it('returns ok when every route chunk contains its marker', () => {
		scaffoldDist(workDir)
		const result = checkBuildTemplates(workDir)
		assert(result.kind === 'ok')
		expect(result.checked).toBe(ROUTE_MARKERS.length)
	})

	it('returns failed when a chunk is missing for a route', () => {
		scaffoldDist(workDir)
		// Remove the welcome chunk so it has no entry in dist/assets.
		rmSync(join(workDir, 'assets', `welcome-route-XXXX.js`))
		const result = checkBuildTemplates(workDir)
		assert(result.kind === 'failed')
		expect(result.failures).toHaveLength(1)
		expect(result.failures[0]).toMatch(/welcome.*no chunk found/)
	})

	it('returns failed when a chunk is present but missing its marker', () => {
		scaffoldDist(workDir, { welcome: '// nothing meaningful here' })
		const result = checkBuildTemplates(workDir)
		assert(result.kind === 'failed')
		expect(result.failures).toHaveLength(1)
		expect(result.failures[0]).toMatch(
			/welcome.*does not contain marker 'welcome-brand'/,
		)
	})

	it('returns failed when multiple chunks are emitted for a single route', () => {
		// Build anomaly — tree-shaking regression or duplicate route
		// definitions could emit two chunks. The lib used to silently
		// pick the first match; it now flags the ambiguity loudly.
		scaffoldDist(workDir)
		writeFileSync(
			join(workDir, 'assets', 'welcome-route-YYYY.js'),
			'// duplicate chunk',
		)
		const result = checkBuildTemplates(workDir)
		assert(result.kind === 'failed')
		expect(result.failures).toHaveLength(1)
		expect(result.failures[0]).toMatch(/welcome.*multiple chunks/)
		expect(result.failures[0]).toMatch(/welcome-route-XXXX\.js/)
		expect(result.failures[0]).toMatch(/welcome-route-YYYY\.js/)
	})

	it('reports every failing route in a single pass', () => {
		scaffoldDist(workDir, {
			welcome: '// blank',
			dashboard: '// blank too',
		})
		const result = checkBuildTemplates(workDir)
		assert(result.kind === 'failed')
		expect(result.failures).toHaveLength(2)
		expect(result.failures.some((f) => f.includes('welcome'))).toBe(true)
		expect(result.failures.some((f) => f.includes('dashboard'))).toBe(true)
	})

	it('shape: ROUTE_MARKERS entries are well-formed, with unique routes and unique markers', () => {
		// Local consistency only: each entry has a kebab-case route slug,
		// a non-empty marker, the route slug does not duplicate another
		// entry, and the marker does not duplicate another entry. Marker
		// uniqueness matters because two routes sharing a marker would
		// each pass their individual checks even if their templates were
		// swapped or one was stripped.
		//
		// This does NOT verify alignment with `src/app-shell.ts` — adding
		// a new route there without updating ROUTE_MARKERS will silently
		// skip that route in the post-build assertion. Keeping the two
		// in sync is a contributor checklist item — see
		// `frontend/docs/runtime-config.md` ("Adding a new route").
		const routes = new Set<string>()
		const markers = new Set<string>()
		for (const { route, marker } of ROUTE_MARKERS) {
			expect(route).toMatch(/^[a-z][a-z-]+$/)
			expect(marker.length).toBeGreaterThan(0)
			expect(routes.has(route)).toBe(false)
			expect(markers.has(marker)).toBe(false)
			routes.add(route)
			markers.add(marker)
		}
	})
})
