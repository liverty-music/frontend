/**
 * Pure library for `verify-bundle-isolation.ts`. Walks the CONSUMER entry
 * (`index.html`) chunk graph in a built `dist/` and asserts that no chunk
 * reachable from it is an admin-origin module — enforcing the bundle-isolation
 * requirement of OpenSpec change `add-admin-console` (design D2):
 *
 *   "the network requests for the consumer entry's chunk graph contain no
 *    module originating from the admin source directory".
 *
 * Mirrors the structure/style of `verify-build-templates.lib.ts`: pure (no
 * process.exit, no console writes), returns a structured result.
 *
 * Admin-origin chunks are identified positionally: the build routes every
 * admin-EXCLUSIVE chunk into `assets/admin/` and names the admin entry chunk
 * `assets/admin-*.js` (see vite.config.ts rollupOptions.output). So a consumer
 * graph is isolated iff none of its reachable chunks is under `assets/admin/`
 * or is the `admin-*` entry chunk.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type IsolationResult =
	| { kind: 'ok'; checked: number }
	| { kind: 'missing-entry'; entryHtml: string }
	| { kind: 'no-seeds'; entryHtml: string }
	| { kind: 'leaked'; leaks: readonly string[] }

const STATIC_IMPORT_RE = /(?:from|import)\s*\(?\s*["']\.\/([A-Za-z0-9_./-]+\.js)["']/g

function isAdminChunk(rel: string): boolean {
	// `rel` is a path relative to dist/, e.g. "assets/admin/welcome-route-x.js"
	// or "assets/admin-x.js" (entry) or "assets/welcome-route-y.js" (consumer).
	const norm = rel.replace(/\\/g, '/')
	if (norm.startsWith('assets/admin/')) return true
	if (/^assets\/admin-[A-Za-z0-9_-]+\.js$/.test(norm)) return true
	return false
}

function extractChunkRefs(content: string): string[] {
	const refs = new Set<string>()
	for (const m of content.matchAll(STATIC_IMPORT_RE)) {
		refs.add(`assets/${m[1].replace(/^\.?\//, '')}`)
	}
	return [...refs]
}

/**
 * BFS the consumer chunk graph from `dist/index.html` and collect any
 * admin-origin chunk reached. Returns a structured result.
 */
export function checkBundleIsolation(distDir: string): IsolationResult {
	const entryHtml = join(distDir, 'index.html')
	if (!existsSync(entryHtml)) {
		return { kind: 'missing-entry', entryHtml }
	}

	const html = readFileSync(entryHtml, 'utf-8')
	// Entry scripts referenced from index.html, e.g. assets/main-xxx.js.
	const seeds = new Set<string>()
	for (const m of html.matchAll(/(?:src|href)="\/?(assets\/[A-Za-z0-9_./-]+\.js)"/g)) {
		seeds.add(m[1])
	}

	// Fail closed if no entry seeds were found. Without this, a build/output
	// change that alters how index.html references its entry chunk would yield
	// an empty walk that reports `ok` with `checked: 0` — the isolation gate
	// would pass while never inspecting the consumer graph, letting a real
	// src/ -> admin/ leak ship undetected.
	if (seeds.size === 0) {
		return { kind: 'no-seeds', entryHtml }
	}

	const visited = new Set<string>()
	const queue = [...seeds]
	const leaks = new Set<string>()
	let checked = 0

	while (queue.length > 0) {
		const rel = queue.shift() as string
		if (visited.has(rel)) continue
		visited.add(rel)

		if (isAdminChunk(rel)) {
			leaks.add(rel)
			// Keep walking siblings, but do not descend into the admin chunk's
			// graph — it is already a confirmed leak.
			continue
		}

		const abs = join(distDir, rel)
		if (!existsSync(abs)) continue
		checked++
		const content = readFileSync(abs, 'utf-8')
		for (const ref of extractChunkRefs(content)) {
			if (!visited.has(ref)) queue.push(ref)
		}
	}

	if (leaks.size > 0) return { kind: 'leaked', leaks: [...leaks] }
	return { kind: 'ok', checked }
}
