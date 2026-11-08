import { describe, expect, it } from 'vitest'
import m3Sys from '../../shared/styles/m3-sys.css?raw'

/**
 * The state, motion, type, elevation, focus ring and touch target tokens and
 * the plain typeface are defined once, in shared/styles/m3-sys.css, and both
 * the fan app and the organizer console load that file. Colors, shapes and the
 * brand typeface are not shared: each app keeps its own values.
 */

const appCss = import.meta.glob<string>(
	['/src/**/*.css', '/organizer/**/*.css'],
	{ query: '?raw', import: 'default', eager: true },
)

/** Custom properties a stylesheet declares, with their raw values. */
function declarations(css: string): Array<{ name: string; value: string }> {
	return [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({
		name: m[1],
		value: m[2]
			.replace(/\s+/g, ' ')
			.replace(/\(\s+/g, '(')
			.replace(/\s+\)/g, ')')
			.trim(),
	}))
}

/** The stylesheet with its prefers-reduced-motion block removed. */
function withoutReducedMotion(css: string): string {
	const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
	return start === -1 ? css : css.slice(0, start)
}

const SHARED_PREFIX =
	/^--md-(sys-(state|motion|typescale|elevation)-|sys-target-size$|ref-typeface-plain$)/

describe('shared M3 system tokens', () => {
	it('@spec components/infrastructure/fan/web/global/design-tokens "One edit applies to both apps"', () => {
		// The hover opacity is written in exactly one place.
		const hover = declarations(withoutReducedMotion(m3Sys)).filter(
			(d) => d.name === '--md-sys-state-hover-opacity',
		)
		expect(hover).toEqual([
			{ name: '--md-sys-state-hover-opacity', value: '0.08' },
		])

		// Both apps load the shared file.
		expect(appCss['/src/styles/main.css']).toMatch(
			/@import\s+"\.\.\/\.\.\/shared\/styles\/m3-sys\.css"/,
		)
		expect(appCss['/organizer/styles/main.css']).toMatch(
			/@import\s+"\.\.\/\.\.\/shared\/styles\/m3-sys\.css"/,
		)

		// Neither app redefines a shared token.
		const redefined = Object.entries(appCss).flatMap(([file, css]) =>
			declarations(css)
				.filter((d) => SHARED_PREFIX.test(d.name))
				.map((d) => `${file}: ${d.name}`),
		)
		expect(redefined).toEqual([])

		// The fan app keeps no motion or state value of its own beside the
		// shared ones, so its components follow an edit of the shared file. The
		// two it keeps have no Material 3 token: a 1 ms duration that still
		// fires transitionend, and the selected opacity Material 3 does not set.
		const own = declarations(appCss['/src/styles/tokens.css'])
			.map((d) => d.name)
			.filter((name) =>
				/^--(md-(state|easing|duration|spring)|transition|fab-state)-/.test(
					name,
				),
			)
		expect(own).toEqual(['--md-duration-instant', '--md-state-selected'])
	})

	it('@spec components/infrastructure/fan/web/global/design-tokens "Colors stay per app"', () => {
		// The shared file carries no color, shape or brand typeface that one app
		// could change for the other: only the shared families.
		const shared = declarations(m3Sys)
		expect(shared.length).toBeGreaterThan(0)
		expect(shared.filter((d) => !SHARED_PREFIX.test(d.name))).toEqual([])

		// Each app names its own shadow color, corner shapes and brand typeface.
		for (const file of [
			'/src/styles/tokens.css',
			'/organizer/styles/tokens.css',
		]) {
			const names = declarations(appCss[file]).map((d) => d.name)
			for (const name of [
				'--md-sys-color-shadow',
				'--md-sys-shape-corner-extra-large',
				'--md-ref-typeface-brand',
			]) {
				expect(names, `${file} ${name}`).toContain(name)
			}
		}

		// Each app gives the shared role name its own value: the fan app's dark
		// navy surface, the console's light/dark pair. Neither reaches the other.
		const roleIn = (file: string, name: string) =>
			declarations(appCss[file]).find((d) => d.name === name)?.value
		expect(roleIn('/src/styles/tokens.css', '--md-sys-color-surface')).toBe(
			'oklch(18% 0.04 275deg)',
		)
		expect(
			roleIn('/organizer/styles/tokens.css', '--md-sys-color-surface'),
		).toBe('light-dark(oklch(99% 0.003 285deg), oklch(18% 0.01 285deg))')
	})
})
