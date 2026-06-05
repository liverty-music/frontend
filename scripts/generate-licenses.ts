/**
 * Build-time OSS license extractor.
 *
 * Walks the *production* dependency tree (`npm ls --omit=dev`) and emits
 * `src/generated/oss-licenses.json`, consumed by the `/legal/licenses` page.
 * Running over the prod tree (not all of node_modules) keeps the list aligned
 * with what is actually distributed in the bundle, and re-running after a
 * dependency change regenerates the artifact — so the page never needs manual
 * upkeep. The artifact is committed so the dev server and tests have it without
 * a generation step; CI regenerates it via the `prebuild` hook before shipping.
 *
 * Output is deterministic (sorted by package name, no timestamp) so an
 * unchanged dependency set produces no git churn.
 *
 * Run via `npm run licenses:generate`.
 */

import { execFileSync } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One bundled third-party package and its attribution metadata. */
interface LicenseEntry {
	readonly name: string
	readonly version: string
	/** SPDX license identifier, or `UNKNOWN` if the package declared none. */
	readonly license: string
	/** Copyright holder / author, when declared. */
	readonly publisher: string | null
	readonly repository: string | null
	/** Verbatim LICENSE-file text for attribution, when present in the package. */
	readonly licenseText: string | null
}

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')
const outFile = join(frontendRoot, 'src', 'generated', 'oss-licenses.json')

// Cap embedded license text so a pathological LICENSE file cannot bloat the
// bundle; the full text is always linkable via the package repository.
const MAX_LICENSE_TEXT = 20_000

function listProductionPackageDirs(): string[] {
	let stdout = ''
	try {
		stdout = execFileSync(
			'npm',
			['ls', '--omit=dev', '--all', '--parseable'],
			{ cwd: frontendRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
		)
	} catch (err) {
		// `npm ls` exits non-zero on peer-dependency warnings but still prints
		// the tree to stdout; recover it rather than aborting the build.
		const e = err as { stdout?: string }
		stdout = e.stdout ?? ''
		if (!stdout) throw err
	}

	const dirs = stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		// The first line is the project root itself — exclude it.
		.filter((dir) => dir !== frontendRoot)

	return [...new Set(dirs)]
}

function normalizeLicense(pkg: Record<string, unknown>): string {
	const { license, licenses } = pkg
	if (typeof license === 'string') return license
	if (license && typeof license === 'object') {
		const type = (license as { type?: string }).type
		if (type) return type
	}
	if (Array.isArray(licenses)) {
		const types = licenses
			.map((l) => (l as { type?: string }).type)
			.filter((t): t is string => typeof t === 'string')
		if (types.length > 0) return types.join(', ')
	}
	return 'UNKNOWN'
}

function normalizePublisher(pkg: Record<string, unknown>): string | null {
	const { author } = pkg
	if (typeof author === 'string') return author
	if (author && typeof author === 'object') {
		const name = (author as { name?: string }).name
		if (name) return name
	}
	return null
}

function normalizeRepository(pkg: Record<string, unknown>): string | null {
	const { repository } = pkg
	if (typeof repository === 'string') return repository
	if (repository && typeof repository === 'object') {
		const url = (repository as { url?: string }).url
		if (url) return url.replace(/^git\+/, '').replace(/\.git$/, '')
	}
	return null
}

function readLicenseText(pkgDir: string): string | null {
	let names: string[]
	try {
		names = readdirSync(pkgDir)
	} catch {
		return null
	}
	const match = names.find((n) => /^(licen[sc]e|copying)/i.test(n))
	if (!match) return null
	try {
		const text = readFileSync(join(pkgDir, match), 'utf8').trim()
		return text.length > MAX_LICENSE_TEXT
			? `${text.slice(0, MAX_LICENSE_TEXT)}\n…(truncated)`
			: text
	} catch {
		return null
	}
}

function buildEntry(pkgDir: string): LicenseEntry | null {
	const manifestPath = join(pkgDir, 'package.json')
	if (!existsSync(manifestPath)) return null
	let pkg: Record<string, unknown>
	try {
		pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
	} catch {
		return null
	}
	const name = pkg.name as string | undefined
	const version = pkg.version as string | undefined
	if (!name || !version) return null

	return {
		name,
		version,
		license: normalizeLicense(pkg),
		publisher: normalizePublisher(pkg),
		repository: normalizeRepository(pkg),
		licenseText: readLicenseText(pkgDir),
	}
}

function main(): void {
	const dirs = listProductionPackageDirs()
	const byName = new Map<string, LicenseEntry>()
	for (const dir of dirs) {
		const entry = buildEntry(dir)
		if (entry) byName.set(`${entry.name}@${entry.version}`, entry)
	}
	const packages = [...byName.values()].sort((a, b) =>
		a.name === b.name
			? a.version.localeCompare(b.version)
			: a.name.localeCompare(b.name),
	)

	mkdirSync(dirname(outFile), { recursive: true })
	writeFileSync(outFile, `${JSON.stringify({ packages }, null, '\t')}\n`)
	console.log(
		`[generate-licenses] wrote ${packages.length} packages to ${outFile}`,
	)
}

main()
