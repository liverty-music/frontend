// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
	checkKnownEntities,
	checkParity,
	collectKeyPaths,
	extractEntityTree,
	validate,
} from '../../scripts/check-brand-vocabulary'

const KNOWN = new Set(['hype', 'concert'])

describe('extractEntityTree', () => {
	it('returns the entity subtree when present', () => {
		const tree = extractEntityTree({ entity: { hype: { label: 'Stage' } } })
		expect(tree).toEqual({ hype: { label: 'Stage' } })
	})

	it('returns an empty object when entity namespace is absent', () => {
		expect(extractEntityTree({ welcome: {} })).toEqual({})
	})

	it('throws when entity is not an object', () => {
		expect(() => extractEntityTree({ entity: 'oops' })).toThrow(
			/must be an object/,
		)
		expect(() => extractEntityTree({ entity: [] })).toThrow(/must be an object/)
		expect(() => extractEntityTree({ entity: null })).toThrow(
			/must be an object/,
		)
	})

	it('throws when root is not an object', () => {
		expect(() => extractEntityTree(null)).toThrow(/must be a JSON object/)
		expect(() => extractEntityTree('hi')).toThrow(/must be a JSON object/)
	})
})

describe('collectKeyPaths', () => {
	it('flattens a nested entity tree into dot-delimited paths', () => {
		const paths = collectKeyPaths({
			hype: {
				label: 'Stage',
				values: { watch: 'Watching', home: 'Home' },
			},
			concert: { label: 'ライブ' },
		})
		expect(paths.sort()).toEqual([
			'concert.label',
			'hype.label',
			'hype.values.home',
			'hype.values.watch',
		])
	})

	it('returns an empty array for an empty tree', () => {
		expect(collectKeyPaths({})).toEqual([])
	})

	it('rejects array nodes', () => {
		expect(() => collectKeyPaths({ hype: ['Stage'] })).toThrow(/got array/)
	})

	it('rejects non-string leaves', () => {
		expect(() => collectKeyPaths({ hype: { label: 42 } })).toThrow(/got number/)
	})
})

describe('checkParity', () => {
	it('returns no errors when both locales have the same key set', () => {
		const same = new Set(['hype.label', 'hype.values.watch'])
		expect(checkParity(same, same)).toEqual([])
	})

	it('reports keys present in JA but missing in EN', () => {
		const ja = new Set(['hype.label', 'hype.values.watch'])
		const en = new Set(['hype.label'])
		const errors = checkParity(ja, en)
		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatch(/entity\.hype\.values\.watch/)
		expect(errors[0]).toMatch(/missing in en/)
	})

	it('reports keys present in EN but missing in JA', () => {
		const ja = new Set(['hype.label'])
		const en = new Set(['hype.label', 'hype.values.away'])
		const errors = checkParity(ja, en)
		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatch(/entity\.hype\.values\.away/)
		expect(errors[0]).toMatch(/missing in ja/)
	})
})

describe('checkKnownEntities', () => {
	it('returns no errors when every stem is known', () => {
		const paths = new Set(['hype.label', 'concert.label'])
		expect(checkKnownEntities(paths, KNOWN)).toEqual([])
	})

	it('reports unknown stems', () => {
		const paths = new Set(['hype.label', 'mystery.label'])
		const errors = checkKnownEntities(paths, KNOWN)
		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatch(/entity\.mystery/)
		expect(errors[0]).toMatch(/unknown entity stem/)
	})

	it('reports each unknown stem only once', () => {
		const paths = new Set(['mystery.label', 'mystery.values.foo'])
		const errors = checkKnownEntities(paths, KNOWN)
		expect(errors).toHaveLength(1)
	})
})

describe('validate (end-to-end pipeline)', () => {
	it('passes when entity is empty in both locales', () => {
		expect(validate({ entity: {} }, { entity: {} }, KNOWN)).toEqual([])
	})

	it('passes when locales agree on key set with asymmetric values', () => {
		const ja = { entity: { hype: { label: 'Stage' } } }
		const en = { entity: { hype: { label: 'Hype' } } }
		expect(validate(ja, en, KNOWN)).toEqual([])
	})

	it('aggregates parity and known-entity violations', () => {
		const ja = { entity: { hype: { label: 'Stage' }, mystery: { label: 'X' } } }
		const en = { entity: { hype: { label: 'Hype' } } }
		const errors = validate(ja, en, KNOWN)
		expect(errors.some((e) => /entity\.mystery\.label/.test(e))).toBe(true)
		expect(errors.some((e) => /entity\.mystery: unknown/.test(e))).toBe(true)
	})
})
