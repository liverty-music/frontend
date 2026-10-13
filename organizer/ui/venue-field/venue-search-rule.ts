/**
 * When the venue field searches the map catalog (design D9, spec
 * `route/concert-editor` "The venue is found by search"): once the trimmed
 * text has at least 3 characters when it contains a Japanese character, or at
 * least 5 otherwise. 「武道館」 must search at 3; a Latin prefix such as "Zepp"
 * matches too broadly below 5.
 */

/** Characters needed when the text contains a Japanese character. */
export const MIN_JAPANESE_LENGTH = 3
/** Characters needed otherwise. */
export const MIN_OTHER_LENGTH = 5
/** The catalog search accepts at most 100 characters after trimming. */
export const MAX_SEARCH_LENGTH = 100

/**
 * A Japanese character: hiragana, katakana or kanji, with the marks that only
 * occur inside Japanese words.
 *
 * - U+3005-U+3007  々 (kanji iteration mark), 〆 (closing mark), 〇 (kanji zero)
 * - U+3031-U+3035  〱〲〳〴〵 (vertical kana iteration marks)
 * - U+303B         〻 (vertical ideographic iteration mark)
 * - U+3041-U+3096  hiragana ぁ-ゖ
 * - U+3099-U+309F  voiced sound marks ゛゜, hiragana iteration marks ゝゞ, ゟ
 * - U+30A1-U+30FA  katakana ァ-ヺ
 * - U+30FC-U+30FF  ー (long vowel mark), katakana iteration marks ヽヾ, ヿ
 * - U+31F0-U+31FF  small katakana for Ainu ㇰ-ㇿ
 * - U+3400-U+4DBF  CJK Unified Ideographs Extension A
 * - U+4E00-U+9FFF  CJK Unified Ideographs
 * - U+F900-U+FAFF  CJK Compatibility Ideographs
 * - U+FF66-U+FF9F  half-width katakana ｦ-ﾝ, ｰ (half-width long vowel mark), ﾞﾟ
 * - U+20000-U+3134F CJK Unified Ideographs Extensions B-G (e.g. 𠮷)
 *
 * Left out on purpose: Japanese punctuation shared with other text (、。・「」
 * and the ideographic space U+3000), so "Zepp・" or "Zepp。" stays Latin.
 */
const JAPANESE =
	/[々-〇〱-〵〻ぁ-ゖ゙-ゟァ-ヺー-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ\u{20000}-\u{3134F}]/u

/** True when `text` contains a hiragana, katakana or kanji character. */
export function containsJapanese(text: string): boolean {
	return JAPANESE.test(text)
}

/** Characters `text` needs before it is searched: 3 with Japanese, else 5. */
export function minSearchLength(text: string): number {
	return containsJapanese(text) ? MIN_JAPANESE_LENGTH : MIN_OTHER_LENGTH
}

/**
 * The text to search for, or null when `text` is not searched yet. Surrounding
 * white space, including the full-width space, is trimmed first; length counts
 * characters (code points), so a supplementary kanji counts once.
 */
export function searchableText(text: string): string | null {
	const trimmed = text.trim()
	const length = [...trimmed].length
	if (length > MAX_SEARCH_LENGTH) return null
	return length >= minSearchLength(trimmed) ? trimmed : null
}
