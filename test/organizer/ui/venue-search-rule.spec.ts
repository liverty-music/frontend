import { describe, expect, it } from 'vitest'
import {
	containsJapanese,
	MAX_SEARCH_LENGTH,
	minSearchLength,
	searchableText,
} from '../../../organizer/ui/venue-field/venue-search-rule'

/**
 * The venue field searches once the trimmed text has 3 characters when it
 * contains a Japanese character, or 5 otherwise (design D9; spec
 * `route/concert-editor` "Short Japanese name", "Short Latin text").
 */
describe('venue search rule', () => {
	it('searches a Japanese name at 3 characters', () => {
		expect(searchableText('武道館')).toBe('武道館')
		expect(searchableText('武道')).toBeNull()
	})

	it('does not search a Latin text below 5 characters', () => {
		expect(searchableText('Zepp')).toBeNull()
		expect(searchableText('Zepp ')).toBeNull()
		expect(searchableText('Zepp H')).toBe('Zepp H')
		expect(searchableText('LIQUI')).toBe('LIQUI')
	})

	it('applies the Japanese rule to mixed text', () => {
		expect(minSearchLength('Zepp羽田')).toBe(3)
		expect(searchableText('Z羽田')).toBe('Z羽田')
		expect(searchableText('Zepp羽田')).toBe('Zepp羽田')
	})

	it('trims full-width and other white space first', () => {
		expect(searchableText('　武道館　')).toBe('武道館')
		expect(searchableText('　武道　')).toBeNull()
		expect(searchableText('  Zepp　')).toBeNull()
		expect(searchableText('\t\n')).toBeNull()
	})

	it('counts characters, not UTF-16 units', () => {
		// 𠮷 is outside the BMP: two UTF-16 units, one character.
		expect(searchableText('𠮷野')).toBeNull()
		expect(searchableText('𠮷野家')).toBe('𠮷野家')
	})

	it('does not search text longer than the catalog accepts', () => {
		expect(searchableText('a'.repeat(MAX_SEARCH_LENGTH))).not.toBeNull()
		expect(searchableText('a'.repeat(MAX_SEARCH_LENGTH + 1))).toBeNull()
	})

	it.each([
		['hiragana', 'ぶどうかん'],
		['katakana', 'リキッド'],
		['long vowel mark', 'ー'],
		['half-width katakana', 'ﾘｷｯﾄﾞ'],
		['half-width long vowel mark', 'ｰ'],
		['kanji', '館'],
		['kanji iteration mark', '々'],
		['hiragana iteration mark', 'ゝ'],
		['katakana iteration mark', 'ヽ'],
		['kanji extension A', '㐂'],
		['kanji extension B', '𠮷'],
		['compatibility ideograph', '﨑'],
	])('treats %s as Japanese', (_, text) => {
		expect(containsJapanese(text)).toBe(true)
	})

	it.each([
		['Latin', 'Zepp Haneda'],
		['full-width Latin', 'ＺＥＰＰ'],
		['Japanese punctuation', 'Zepp・。、「」'],
		['ideographic space', 'Zepp　H'],
		['Korean', '서울'],
	])('does not treat %s as Japanese', (_, text) => {
		expect(containsJapanese(text)).toBe(false)
	})
})
