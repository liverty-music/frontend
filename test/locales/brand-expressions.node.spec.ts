// @vitest-environment node

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HYPE_TIERS } from '../../src/adapter/view/hype-display'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'

type Tree = { [key: string]: string | Tree }

function lookup(catalog: Tree, key: string): string | Tree | undefined {
	return key
		.split('.')
		.reduce<string | Tree | undefined>(
			(node, part) =>
				node !== undefined && typeof node !== 'string' ? node[part] : undefined,
			catalog,
		)
}

/** Every leaf of a catalog as `dotted.key → text`. */
function leaves(tree: Tree, prefix = ''): [string, string][] {
	return Object.entries(tree).flatMap(([key, value]) =>
		typeof value === 'string'
			? [[`${prefix}${key}`, value] as [string, string]]
			: leaves(value, `${prefix}${key}.`),
	)
}

const TABS = [
	['nav.home', 'Timetable'],
	['nav.discovery', 'Discovery'],
	['nav.myArtists', 'My Artists'],
	['nav.tickets', 'Tickets'],
	['nav.settings', 'Settings'],
] as const

describe('Layer B brand expressions', () => {
	// @spec components/infrastructure/fan/web/global/i18n "Initial registry contents"
	it('shows every registry expression in its registered JA and EN form', () => {
		// Product name: full form in the HTML title and the manifest `name`,
		// the space-less short form in `short_name`.
		const html = readFileSync('index.html', 'utf8')
		expect(html).toMatch(/<title>Liverty Music<\/title>/)
		const manifest = JSON.parse(
			readFileSync('public/manifest.webmanifest', 'utf8'),
		)
		expect(manifest.name).toBe('Liverty Music')
		expect(manifest.short_name).toBe('LivertyMusic')

		// Navigation tabs and the lanes: the same text in both locales.
		for (const [key, label] of TABS) {
			expect(lookup(ja as Tree, key), `ja ${key}`).toBe(label)
			expect(lookup(en as Tree, key), `en ${key}`).toBe(label)
		}
		for (const [key, label] of [
			['dashboard.lane.home', 'HOME'],
			['dashboard.lane.near', 'NEAR'],
			['dashboard.lane.away', 'AWAY'],
			['pageHelp.dashboard.homeLabel', 'HOME'],
			['pageHelp.dashboard.nearLabel', 'NEAR'],
			['pageHelp.dashboard.awayLabel', 'AWAY'],
		] as const) {
			expect(lookup(ja as Tree, key), `ja ${key}`).toBe(label)
			expect(lookup(en as Tree, key), `en ${key}`).toBe(label)
		}

		// Hype tiers: rendered from code, one English form for every locale.
		expect(Object.values(HYPE_TIERS).map((tier) => tier.label)).toEqual([
			'Watch',
			'Home',
			'Nearby',
			'Away',
		])
		for (const catalog of [ja, en]) {
			expect(lookup(catalog as Tree, 'entity.hype')).toBeUndefined()
		}
		expect(lookup(ja as Tree, 'pageHelp.myArtists.description')).toContain(
			'Hype',
		)
		expect(lookup(en as Tree, 'pageHelp.myArtists.description')).toContain(
			'Hype',
		)

		// The personal-timetable promise.
		expect(lookup(ja as Tree, 'welcome.preview.label')).toContain(
			'あなただけのタイムテーブル',
		)
		expect(
			(lookup(en as Tree, 'welcome.preview.label') as string).toLowerCase(),
		).toContain('your personal timetable')
	})

	// @spec components/infrastructure/fan/web/global/i18n "Navigation tab labels are invariant across locales"
	it('renders a tab label and its route header from one invariant nav.* key', () => {
		for (const [key] of TABS) {
			expect(lookup(ja as Tree, key)).toBe(lookup(en as Tree, key))
		}

		// Each tab route's page header binds the same `nav.*` key as its bar
		// label, not a separate title key; the shell passes `titleKey` on.
		const shell = readFileSync('src/app-shell.ts', 'utf8')
		for (const [key] of TABS) {
			const route = new RegExp(
				`data: \\{[^}]*titleKey: '${key.replace('.', '\\.')}'[^}]*\\}`,
			)
			expect(shell, `route data for ${key}`).toMatch(route)
		}
		for (const match of shell.matchAll(/labelKey: '(nav\.\w+)'/g)) {
			expect(shell).toMatch(new RegExp(`titleKey: '${match[1]}'`))
		}
		expect(readFileSync('src/app-shell.html', 'utf8')).toContain(
			'title-key.bind="titleKey"',
		)
	})

	// @spec components/infrastructure/fan/web/global/i18n "Japanese gloss is prose, not label"
	it('keeps the gloss of Hype inside prose, never as a label or a key', () => {
		const glossed = leaves(ja as Tree).filter(([, text]) =>
			text.includes('熱量'),
		)
		expect(glossed.length).toBeGreaterThan(0)
		for (const [key, text] of glossed) {
			// The gloss is the parenthetical after the word, in a longer phrase.
			expect(text, key).toMatch(/Hype（熱量）\s*\S/)
			expect(text.trim(), key).not.toBe('Hype（熱量）')
			expect(key.toLowerCase(), key).not.toMatch(/gloss|netsuryo|熱量/)
		}
		// No JA value is the gloss alone, and nothing in EN carries it.
		expect(leaves(ja as Tree).filter(([, t]) => t.trim() === '熱量')).toEqual(
			[],
		)
		expect(leaves(en as Tree).filter(([, t]) => t.includes('熱量'))).toEqual([])
		// The surface labels stay the invariant English form.
		for (const tier of Object.values(HYPE_TIERS)) {
			expect(tier.label).not.toContain('熱量')
		}
	})
})
