/**
 * Brand-vocabulary lint: enforces invariants on the i18n `entity.*` namespace.
 *
 * Verifies that:
 *   1. Every key path under `entity.*` in one locale exists in the other locale.
 *   2. Every second-segment stem (the entity name) appears in the curated
 *      KNOWN_ENTITY_STEMS list.
 *
 * Asymmetric values (different surface labels per locale, e.g. JA "Stage" vs
 * EN "Hype" for `entity.hype.label`) are intentionally permitted and not
 * flagged — that is normal localization, not drift.
 *
 * Exits 0 on success, 1 on failure. Run via `npx tsx scripts/check-brand-vocabulary.ts`.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { KNOWN_ENTITY_STEMS } from './known-entities'

const REPO_ROOT = path.join(import.meta.dirname, '..')
const JA_TRANSLATION_PATH = path.join(
	REPO_ROOT,
	'src/locales/ja/translation.json',
)
const EN_TRANSLATION_PATH = path.join(
	REPO_ROOT,
	'src/locales/en/translation.json',
)

type EntityTree = Record<string, unknown>

/**
 * Extract the `entity` subtree from a parsed translation JSON. Returns an
 * empty object when the namespace is absent or empty. Throws when the
 * namespace exists but is not a plain object.
 */
export function extractEntityTree(parsed: unknown): EntityTree {
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('translation file root must be a JSON object')
	}
	const entity = (parsed as Record<string, unknown>).entity
	if (entity === undefined) return {}
	if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) {
		throw new Error('top-level "entity" must be an object')
	}
	return entity as EntityTree
}

/**
 * Recursively flatten an entity subtree into dot-delimited key paths
 * (relative to `entity`, so "hype.label", "hype.values.watch", etc.).
 * Leaf values are strings; non-string leaves are rejected.
 */
export function collectKeyPaths(node: unknown, prefix = ''): string[] {
	if (typeof node === 'string') {
		if (prefix === '') {
			throw new Error('entity tree root may not be a string')
		}
		return [prefix]
	}
	if (node === null || typeof node !== 'object' || Array.isArray(node)) {
		throw new Error(
			`entity.${prefix || '(root)'}: must be an object or string, got ${
				Array.isArray(node) ? 'array' : typeof node
			}`,
		)
	}
	const out: string[] = []
	for (const [k, v] of Object.entries(node)) {
		const next = prefix ? `${prefix}.${k}` : k
		out.push(...collectKeyPaths(v, next))
	}
	return out
}

/** Locale parity: every key in one locale must exist in the other. */
export function checkParity(
	jaPaths: ReadonlySet<string>,
	enPaths: ReadonlySet<string>,
): string[] {
	const errors: string[] = []
	for (const p of jaPaths) {
		if (!enPaths.has(p)) {
			errors.push(
				`entity.${p}: present in ja/translation.json but missing in en/translation.json`,
			)
		}
	}
	for (const p of enPaths) {
		if (!jaPaths.has(p)) {
			errors.push(
				`entity.${p}: present in en/translation.json but missing in ja/translation.json`,
			)
		}
	}
	return errors
}

/** Every second-segment stem must be a known entity. */
export function checkKnownEntities(
	allPaths: ReadonlySet<string>,
	known: ReadonlySet<string> = KNOWN_ENTITY_STEMS,
): string[] {
	const errors: string[] = []
	const seen = new Set<string>()
	for (const p of allPaths) {
		const stem = p.split('.')[0]
		if (seen.has(stem)) continue
		seen.add(stem)
		if (!known.has(stem)) {
			errors.push(
				`entity.${stem}: unknown entity stem (add it to scripts/known-entities.ts if it corresponds to a real protobuf entity)`,
			)
		}
	}
	return errors
}

/** Pure validation pipeline — exposed for unit tests. */
export function validate(
	jaParsed: unknown,
	enParsed: unknown,
	known: ReadonlySet<string> = KNOWN_ENTITY_STEMS,
): string[] {
	const jaTree = extractEntityTree(jaParsed)
	const enTree = extractEntityTree(enParsed)
	const jaPaths = new Set(collectKeyPaths(jaTree))
	const enPaths = new Set(collectKeyPaths(enTree))
	const errors: string[] = []
	errors.push(...checkParity(jaPaths, enPaths))
	const all = new Set<string>([...jaPaths, ...enPaths])
	errors.push(...checkKnownEntities(all, known))
	return errors
}

function readJson(filePath: string): unknown {
	const raw = fs.readFileSync(filePath, 'utf-8')
	return JSON.parse(raw)
}

function main(): void {
	const jaParsed = readJson(JA_TRANSLATION_PATH)
	const enParsed = readJson(EN_TRANSLATION_PATH)
	const errors = validate(jaParsed, enParsed)

	if (errors.length > 0) {
		console.error('brand-vocabulary lint failed:')
		for (const e of errors) {
			console.error(`  - ${e}`)
		}
		process.exit(1)
	}

	const jaTree = extractEntityTree(jaParsed)
	const count = collectKeyPaths(jaTree).length
	console.log(
		`brand-vocabulary lint OK (${count} entity.* keys verified across JA + EN)`,
	)
}

// Only execute when invoked as the entry script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
	main()
}
