import { globSync, readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * Every native button gets its look from the shared layers: the reset gives
 * the pointer cursor, global.css a borderless transparent box, its hover and
 * focus layer and the high-contrast border. A fan block that sets
 * `background: transparent`, `border: none` or `cursor: pointer` on a button
 * only repeats them, and the first two also remove the hover layer and the
 * high-contrast border (block beats global).
 */

const templates = globSync('src/**/*.html')
const stylesheets = globSync('src/{components,routes}/**/*.css')

/** Classes that some <button> in a fan template carries. */
function buttonClasses(): Set<string> {
	const classes = new Set<string>()
	for (const file of templates) {
		const html = readFileSync(file, 'utf8')
		for (const tag of html.matchAll(/<button\b(?:=>|[^>])*>/g)) {
			const attr = tag[0].match(/\sclass="([^"]*)"/)?.[1] ?? ''
			for (const c of attr.replace(/[[\]]/g, ' ').split(/\s+/)) {
				if (c) classes.add(c)
			}
		}
	}
	// The shared button and the press utility own their own looks.
	for (const c of ['button', 'pressable']) classes.delete(c)
	return classes
}

const REPEATS = (prop: string, value: string): boolean =>
	(prop === 'cursor' && value === 'pointer') ||
	(prop === 'border' && (value === 'none' || value === '0')) ||
	((prop === 'background' || prop === 'background-color') &&
		(value === 'transparent' || value === 'none'))

describe('button defaults', () => {
	it('no fan block repeats or undoes the shared button rules', () => {
		const classes = buttonClasses()
		const found: string[] = []
		for (const file of stylesheets) {
			postcss.parse(readFileSync(file, 'utf8')).walkDecls((decl) => {
				if (!REPEATS(decl.prop, decl.value)) return
				const parent = decl.parent
				if (parent?.type !== 'rule') return
				const selector = (parent as postcss.Rule).selector
				// State rules (hover, pressed, selected) may set their own.
				if (/:hover|:active|:focus|:disabled|\[data-|\[aria-/.test(selector))
					return
				const subjects = selector.split(',').map(
					(part) =>
						part
							.trim()
							.split(/[\s>+~]+/)
							.pop() ?? '',
				)
				const onButton = subjects.some(
					(subject) =>
						/^button\b/.test(subject) ||
						(subject.match(/\.[\w-]+/g) ?? []).some((c) =>
							classes.has(c.slice(1)),
						),
				)
				if (onButton)
					found.push(
						`${file}:${decl.source?.start?.line} ${selector} ${decl.prop}: ${decl.value}`,
					)
			})
		}
		expect(found).toEqual([])
	})
})
