import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en/translation.json'
import ja from '../../src/locales/ja/translation.json'

type Tree = { [key: string]: string | Tree }

/** Flatten a translation subtree to `dotted.key → string`. */
function flatten(tree: Tree, prefix: string): Map<string, string> {
	const out = new Map<string, string>()
	for (const [key, value] of Object.entries(tree)) {
		const path = `${prefix}.${key}`
		if (typeof value === 'string') out.set(path, value)
		else for (const entry of flatten(value, path)) out.set(...entry)
	}
	return out
}

// Hiragana, katakana or kanji.
const JAPANESE = /[぀-ヿ㐀-鿿]/

describe('All Nearby copy', () => {
	const jaKeys = flatten(ja.allNearby as Tree, 'allNearby')
	const enKeys = flatten(en.allNearby as Tree, 'allNearby')

	// @spec components/infrastructure/fan/web/route/dashboard "All Nearby strings are natural Japanese"
	it('keeps the Japanese and English bundles at parity and fully translated', () => {
		expect([...jaKeys.keys()].sort()).toEqual([...enKeys.keys()].sort())

		// Every Japanese string is written in Japanese — none is left as the
		// English source or as a bare placeholder. Whether the phrasing reads
		// naturally is judged in review; this guards against untranslated copy.
		const untranslated = [...jaKeys]
			.filter(([, text]) => !JAPANESE.test(text.replace(/\{\{\w+\}\}/g, '')))
			.map(([key]) => key)
		expect(untranslated).toEqual([])
		const copiedFromEnglish = [...jaKeys]
			.filter(([key, text]) => text === enKeys.get(key))
			.map(([key]) => key)
		expect(copiedFromEnglish).toEqual([])
	})
})
