import { globSync, readFileSync } from 'node:fs'
import postcss, { type Declaration } from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * Depth in both apps: a shadow is one of the shared Material 3 elevation
 * levels, a glow is a `--glow-*` token, and a resting surface reads as raised
 * by its surface tier rather than a cast shadow. A shadow that is neither
 * (a glow in a colour set per element, a scrim drawn as a shadow) sits under
 * a described stylelint disable, which names the spec that describes it.
 */

const stylesheets = globSync('{src,shared,organizer}/**/*.css').filter(
	(file) => !file.includes('/styles/tokens.css'),
)

const ALLOWED =
	/^(none|var\(--md-sys-elevation-level[1-5]\)|var\(--glow-[\w-]+\))$/

/** A stylelint disable of an allowed-list rule, with a reason after `--`. */
const describes = (text: string): boolean =>
	/^stylelint-disable/.test(text) &&
	/allowed-list/.test(text) &&
	/ -- \S/.test(text)

/** Whether a described disable for a box-shadow rule covers `decl`. */
function disabled(decl: Declaration): boolean {
	let node = decl.prev()
	while (node && node.type === 'comment') {
		if (describes(node.text)) {
			return true
		}
		node = node.prev()
	}
	// A block disable earlier in the same rule or an enclosing one.
	let parent = decl.parent
	while (parent) {
		const hit = (parent as { nodes?: postcss.ChildNode[] }).nodes?.some(
			(n) => n.type === 'comment' && describes(n.text),
		)
		if (hit) return true
		parent = parent.parent as typeof parent
	}
	return false
}

function shadows(): Array<{
	where: string
	value: string
	described: boolean
}> {
	const out: Array<{ where: string; value: string; described: boolean }> = []
	for (const file of stylesheets) {
		const root = postcss.parse(readFileSync(file, 'utf8'), { from: file })
		root.walkDecls('box-shadow', (decl) => {
			out.push({
				where: `${file}:${decl.source?.start?.line}`,
				value: decl.value.replace(/\s+/g, ' ').trim(),
				described: disabled(decl),
			})
		})
	}
	return out
}

describe('elevation', () => {
	it('every shadow is an elevation level or a glow token, or a described exception', () => {
		const raw = shadows().filter((s) => !ALLOWED.test(s.value) && !s.described)
		expect(raw).toEqual([])
	})

	it('the exceptions are the spec-defined ones', () => {
		const files = new Set(
			shadows()
				.filter((s) => !ALLOWED.test(s.value))
				.map((s) => s.where.split(':')[0]),
		)
		expect([...files].sort()).toEqual([
			// The coach mark's dimmed layer around the spotlight.
			'src/components/coach-mark/coach-mark.css',
			// The matched card's glow in its artist's hue.
			'src/components/live-highway/event-card-spotlight.css',
			// The hype tier glows in the artist's colour.
			'src/routes/my-artists/hype-dot-radio.css',
		])
	})

	it('@spec components/infrastructure/fan/web/global/design-tokens "Resting depth uses a tonal tier"', () => {
		// The card both apps use rests on a surface tier and casts no shadow.
		const card = postcss.parse(readFileSync('shared/styles/card.css', 'utf8'))
		const props = new Map<string, string>()
		card.walkDecls((d) => {
			props.set(d.prop, d.value)
		})
		expect(props.has('box-shadow')).toBe(false)
		expect(props.get('background')).toMatch(
			/^var\(--md-sys-color-surface-container(-\w+)?\)$/,
		)
		// The shared button rests at level 0, as Material 3's common buttons do.
		const button = readFileSync('src/styles/button.css', 'utf8')
		expect(button).not.toMatch(/box-shadow/)
	})
})
