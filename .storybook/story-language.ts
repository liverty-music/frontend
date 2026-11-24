/**
 * The language a story runs in. The `storybook-ja` Vitest project sets the
 * `language` global to `ja`; the others leave it unset, and a story then runs
 * as before, in the page's own language. Set from `preview.ts` before each
 * story and put back when it is torn down.
 *
 * Under `ja` the document's `lang` is `ja`, so Japanese text takes the medium
 * language line height (design-tokens "Material 3 type styles"). Visual
 * baselines belong to the default language, so under `ja` a story is compared
 * with a screenshot only when it is tagged `japanese`, and then with a
 * baseline of its own (`-ja` after its name; see `screenshot.ts`).
 */
export const storyLanguage = { lang: '', baseline: false }

/** Apply the language of this story; returns the function that undoes it. */
export function applyStoryLanguage(
	language: unknown,
	tags: readonly string[] = [],
): () => void {
	const root = document.documentElement
	const before = root.lang
	if (typeof language !== 'string' || language === '') {
		storyLanguage.lang = ''
		storyLanguage.baseline = false
		return () => {}
	}
	root.lang = language
	storyLanguage.lang = language
	storyLanguage.baseline = tags.includes('japanese')
	return () => {
		root.lang = before
		storyLanguage.lang = ''
		storyLanguage.baseline = false
	}
}
