/**
 * Entry point for the e2e coverage assertion. Delegates to the pure
 * `verify-e2e-coverage.lib.ts` and maps its result to console output and an
 * exit code.
 *
 * Run via `npm run verify:e2e-coverage` (wired into `make lint`).
 *
 * The set of executed projects is DERIVED from the workflow files rather than
 * listed here. Hardcoding it would reproduce the failure this check exists to
 * catch: a list that says everything is covered while CI actually runs
 * something else. If a job stops invoking a project, this check must notice.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { exit } from 'node:process'
import {
	checkE2eCoverage,
	type KnownGap,
	type ProjectRun,
} from './verify-e2e-coverage.lib'

/**
 * Specs CI cannot run, with the capability the environment actually lacks.
 *
 * Keep in step with `docs/ci-coverage-gaps.md`, which carries the full
 * reasoning and the named control for each. An entry here is a claim that the
 * spec CANNOT run — not that it is inconvenient to.
 */
const KNOWN_GAPS: KnownGap[] = [
	{
		spec: 'e2e/pwa/pwa-install-prompt.spec.ts',
		reason:
			'`beforeinstallprompt` fires only once Chromium install heuristics are satisfied; headless CI never satisfies them and Playwright cannot synthesise the event.',
	},
	{
		spec: 'e2e/pwa/pwa-settings.spec.ts',
		reason:
			'Needs `storageState` from a real OIDC login with an ESC-held credential; CI cannot obtain it and `.auth/` is gitignored.',
	},
	{
		spec: 'e2e/smoke/post-deploy.spec.ts',
		reason:
			'Runs against a deployed URL from push-image.yaml (`SMOKE_BASE_URL`), not against a PR build. Covered, but not by pull-request CI.',
	},
]

/** Every spec that exists, relative to the frontend root. */
function allSpecs(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			out.push(...allSpecs(full))
		} else if (entry.endsWith('.spec.ts')) {
			out.push(full)
		}
	}
	return out
}

interface Invocation {
	config: string
	projects: string[]
}

/**
 * Find every `playwright test` CI actually runs, resolving `npm run <script>`
 * through package.json so an invocation hidden behind a script alias still
 * counts.
 */
function ciInvocations(): Invocation[] {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
		scripts: Record<string, string>
	}
	const workflows = readdirSync('.github/workflows').filter(
		(f) => f.endsWith('.yaml') || f.endsWith('.yml'),
	)

	const found: Invocation[] = []
	for (const wf of workflows) {
		const source = readFileSync(join('.github/workflows', wf), 'utf8')
		for (let line of source.split('\n')) {
			line = line.trim()
			const alias = line.match(/npm run ([\w:-]+)/)
			if (alias?.[1] && pkg.scripts[alias[1]]) {
				line = pkg.scripts[alias[1]]
			}
			if (!line.includes('playwright test')) continue
			// The post-deploy smoke config targets a deployed URL, so it is not
			// pull-request coverage; it is recorded as a gap instead.
			if (line.includes('playwright.smoke.config.mjs')) continue
			const config =
				line.match(/--config=(\S+)/)?.[1] ?? 'playwright.config.mjs'
			const projects = [...line.matchAll(/--project=([\w-]+)/g)].map(
				(m) => m[1] as string,
			)
			found.push({ config, projects })
		}
	}
	return found
}

/** Ask Playwright which specs a project matches. `--list` starts no server. */
function listSpecs(config: string, project?: string): string[] {
	const args = ['playwright', 'test', `--config=${config}`, '--list', '--reporter=json']
	if (project) args.push(`--project=${project}`)
	let raw: string
	try {
		raw = execFileSync('npx', args, {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			maxBuffer: 32 * 1024 * 1024,
		})
	} catch {
		// Playwright exits non-zero when a project matches nothing. That is a
		// finding, not a crash — report it as an empty project.
		return []
	}
	const report = JSON.parse(raw) as {
		config?: { rootDir?: string }
		suites?: { file?: string }[]
	}
	const files = new Set<string>()
	const walk = (suites: { file?: string; suites?: unknown }[]): void => {
		for (const s of suites) {
			if (s.file) files.add(s.file)
			if (Array.isArray(s.suites)) walk(s.suites as { file?: string }[])
		}
	}
	walk(report.suites ?? [])
	// Paths in the report are relative to the config's OWN rootDir, which
	// differs per config (`./e2e` for the main one, `./e2e/pwa` for the PWA
	// one). Resolve against the reported rootDir rather than assuming, or the
	// PWA specs normalise to the wrong path and read as uncovered.
	const rootDir = report.config?.rootDir ?? process.cwd()
	return [...files].map((f) => relative(process.cwd(), join(rootDir, f)))
}

const runs: ProjectRun[] = []
for (const inv of ciInvocations()) {
	if (inv.projects.length === 0) {
		runs.push({ project: inv.config, specs: listSpecs(inv.config) })
		continue
	}
	for (const project of inv.projects) {
		runs.push({ project, specs: listSpecs(inv.config, project) })
	}
}

const specs = allSpecs('e2e')
const result = checkE2eCoverage(specs, runs, KNOWN_GAPS)

if (result.kind === 'failed') {
	console.error('[verify-e2e-coverage] FAILED:')
	for (const f of result.failures) {
		if (f.kind === 'empty-project') {
			console.error(
				`  project "${f.project}" matched NO specs — CI runs it and it verifies nothing`,
			)
		} else if (f.kind === 'uncovered-spec') {
			console.error(
				`  ${f.spec} is executed by no project and is not a recorded gap`,
			)
		} else {
			console.error(`  stale gap: ${f.spec} — ${f.detail}`)
		}
	}
	console.error(
		'\n  Wire the spec into a project CI runs, or add it to KNOWN_GAPS in',
	)
	console.error(
		'  scripts/verify-e2e-coverage.ts AND docs/ci-coverage-gaps.md with the',
	)
	console.error('  capability the CI environment actually lacks.')
	exit(1)
}

console.log(
	`[verify-e2e-coverage] OK — ${result.specs} spec(s), ${result.projects} CI project run(s), ${result.gaps} recorded gap(s).`,
)
