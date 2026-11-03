// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createCatalogI18n } from '../../../test/helpers/catalog-i18n'
import type { Hype } from '../../entities/follow'
import enCatalog from '../../locales/en/translation.json'
import { HYPE_TIERS, hypeReachWords } from './hype-display'

describe('HYPE_TIERS', () => {
	const ALL_HYPES: Hype[] = ['watch', 'home', 'nearby', 'away']

	it('has an entry for every Hype value', () => {
		expect(Object.keys(HYPE_TIERS).sort()).toEqual([...ALL_HYPES].sort())
	})

	it.each(ALL_HYPES)('%s has non-empty label and icon', (hype) => {
		const tier = HYPE_TIERS[hype]
		expect(tier.label).toBeTruthy()
		expect(tier.icon).toBeTruthy()
	})

	it.each([
		['watch', 'Watch'],
		['home', 'Home'],
		['nearby', 'Nearby'],
		['away', 'Away'],
	] as const)('%s renders the invariant English label %s', (hype, label) => {
		expect(HYPE_TIERS[hype].label).toBe(label)
	})
})

describe('hypeReachWords', () => {
	const ja = createCatalogI18n()
	const en = createCatalogI18n(enCatalog, 'en')
	const words = (hype: Hype, home: string | undefined, i18n = ja) =>
		hypeReachWords(hype, home, (key, options) => i18n.tr(key, options))

	it.each([
		['away', '全て'],
		['home', '東京'],
		['nearby', '東京周辺'],
	] as const)('%s with a home in Tokyo reads %s', (hype, expected) => {
		expect(words(hype, 'JP-13')).toBe(expected)
	})

	it.each([
		['away', '全て'],
		['home', '居住エリア'],
		['nearby', '居住エリア周辺'],
	] as const)('%s without a home reads %s', (hype, expected) => {
		expect(words(hype, undefined)).toBe(expected)
	})

	it('names Osaka for Home in Osaka', () => {
		expect(words('home', 'JP-27')).toBe('大阪')
	})

	it.each([undefined, 'JP-13'])(
		'has no place words for Watch (home %s)',
		(home) => {
			expect(words('watch', home)).toBeNull()
		},
	)

	it.each([
		['away', 'JP-13', 'anywhere'],
		['home', 'JP-13', 'in Tokyo'],
		['nearby', 'JP-13', 'around Tokyo'],
		['nearby', undefined, 'around your area'],
	] as const)('%s (home %s) reads "%s" in English', (hype, home, expected) => {
		expect(words(hype, home, en)).toBe(expected)
	})
})
