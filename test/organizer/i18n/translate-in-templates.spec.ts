import { describe, expect, it } from 'vitest'

/**
 * Text is translated in templates, never in view-models (design D17): a
 * view-model exposes catalog keys and their values, and the template
 * translates them with `t` / `& t`, so a language switch re-renders every
 * text. Only `organizer/i18n/` (the formatters and the language switch) calls
 * i18n's `tr`.
 */

const sources = import.meta.glob<string>('/organizer/**/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
})

/** `tr(` calls and `.tr` references, as `file:line: code`. */
function translationsIn(file: string, source: string): string[] {
	return source
		.split('\n')
		.flatMap((line, i) =>
			/(^|[^\w$])tr\(|\.tr\b/.test(line)
				? [`${file}:${i + 1}: ${line.trim()}`]
				: [],
		)
}

describe('console view-models', () => {
	it('translate nothing outside organizer/i18n', () => {
		const offenders = Object.entries(sources)
			.filter(([file]) => !file.startsWith('/organizer/i18n/'))
			.flatMap(([file, source]) => translationsIn(file, source))
		expect(offenders).toEqual([])
	})

	it('finds a translation call', () => {
		expect(translationsIn('a.ts', "this.i18n.tr('common.save')")).toEqual([
			"a.ts:1: this.i18n.tr('common.save')",
		])
		expect(translationsIn('a.ts', "const t = tr('x')")).toHaveLength(1)
		expect(translationsIn('a.ts', 'const f = i18n.tr')).toHaveLength(1)
		expect(translationsIn('a.ts', "attr('x'); str('y'); entr()")).toEqual([])
	})

	it('reads the console sources', () => {
		expect(Object.keys(sources)).toContain(
			'/organizer/settings/settings-route.ts',
		)
	})
})
