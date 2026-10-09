/**
 * Pure library for `verify-reception-bundle.ts`. Inspects the reception app's
 * build output (`dist-reception/`, built by `vite.reception.config.ts`) and
 * asserts it holds no OIDC client and no console or consumer code: the
 * reception page must never be able to touch console sign-in state (OpenSpec
 * change `isolate-venue-reception`, design D4). It also measures the output.
 *
 * Mirrors `verify-bundle-isolation.lib.ts`: pure (no process.exit, no console
 * writes), returns a structured result.
 *
 * The output is a separate build, so every file in it is the reception app's;
 * the check therefore scans all of it rather than walking a chunk graph.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

/**
 * Strings that survive minification and appear only when the OIDC client
 * (`oidc-client-ts`) or the console's sign-in service is bundled.
 */
export const OIDC_MARKERS: readonly string[] = [
	// oidc-client-ts public API and error text (property names and literals
	// are kept by the minifier).
	'OidcClient',
	'signinRedirect',
	'No matching state found in storage',
	// shared/services/auth-service.ts: the Zitadel org-scope prefix.
	'urn:zitadel',
]

/**
 * Custom element names of the other apps' shells and console screens. Aurelia
 * keeps element names as strings, so any of these means that app's code is in
 * the output.
 */
export const CONSOLE_MARKERS: readonly string[] = [
	'app-shell',
	'admin-shell',
	'organizer-shell',
	'concerts-route',
	'reception-links-route',
	'approval-queue-route',
]

/** Present in every real reception build; guards against scanning the wrong output. */
export const RECEPTION_MARKER = 'reception-shell'

/** Output paths that belong to the other entries' builds. */
const FOREIGN_PATHS: readonly RegExp[] = [
	/^index\.html$/,
	/^admin\.html$/,
	/^organizer\.html$/,
	/^sw\.js$/,
	/^manifest\.webmanifest$/,
	/^assets\/admin\//,
	/^assets\/organizer\//,
	/^assets\/(main|admin|organizer)-[A-Za-z0-9_-]+\.js$/,
]

const TEXT_FILE = /\.(js|mjs|css|html|json)$/

export interface OutputFile {
	readonly path: string
	readonly bytes: number
	readonly gzipBytes: number
}

export type ReceptionBundleResult =
	| { kind: 'missing-entry'; entryHtml: string }
	| { kind: 'not-reception'; distDir: string }
	| { kind: 'leaked'; findings: readonly string[] }
	| {
			kind: 'ok'
			files: readonly OutputFile[]
			totalBytes: number
			totalGzipBytes: number
	  }

function listFiles(dir: string): string[] {
	const out: string[] = []
	for (const name of readdirSync(dir)) {
		const abs = join(dir, name)
		if (statSync(abs).isDirectory()) out.push(...listFiles(abs))
		else out.push(abs)
	}
	return out
}

/** Checks a built `dist-reception/` and measures it. */
export function checkReceptionBundle(distDir: string): ReceptionBundleResult {
	const entryHtml = join(distDir, 'reception.html')
	let files: string[]
	try {
		statSync(entryHtml)
		files = listFiles(distDir)
	} catch {
		return { kind: 'missing-entry', entryHtml }
	}

	const findings: string[] = []
	const measured: OutputFile[] = []
	let sawReception = false

	for (const abs of files.sort()) {
		const rel = relative(distDir, abs).replace(/\\/g, '/')
		const content = readFileSync(abs)
		measured.push({
			path: rel,
			bytes: content.byteLength,
			gzipBytes: gzipSync(content).byteLength,
		})

		if (FOREIGN_PATHS.some((re) => re.test(rel))) {
			findings.push(`${rel}: file of another entry's build`)
		}
		if (!TEXT_FILE.test(rel)) continue

		const text = content.toString('utf-8')
		if (text.includes(RECEPTION_MARKER)) sawReception = true
		for (const marker of OIDC_MARKERS) {
			if (text.includes(marker))
				findings.push(`${rel}: OIDC client ("${marker}")`)
		}
		for (const marker of CONSOLE_MARKERS) {
			if (text.includes(marker))
				findings.push(`${rel}: console code ("${marker}")`)
		}
	}

	if (findings.length > 0) return { kind: 'leaked', findings }
	// Fail closed: an output without the reception shell is not the reception
	// build, so a clean scan of it would prove nothing.
	if (!sawReception) return { kind: 'not-reception', distDir }

	return {
		kind: 'ok',
		files: measured,
		totalBytes: measured.reduce((n, f) => n + f.bytes, 0),
		totalGzipBytes: measured.reduce((n, f) => n + f.gzipBytes, 0),
	}
}
