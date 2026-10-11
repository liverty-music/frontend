import { describe, expect, it } from 'vitest'
import m3Sys from '../../shared/styles/m3-sys.css?raw'

/**
 * The state, motion and easing tokens are defined once, in
 * shared/styles/m3-sys.css, and both the fan app and the organizer console
 * load that file. Colors are not shared: each app keeps its own values.
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

const SHARED_PREFIX = /^--md-sys-(state|motion)-/

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

		// The fan app's own names are aliases of the shared tokens, so the fan
		// components follow an edit of the shared file.
		const fan = new Map(
			declarations(appCss['/src/styles/tokens.css']).map((d) => [
				d.name,
				d.value,
			]),
		)
		const aliases: Record<string, string> = {
			'--md-state-hover': '--md-sys-state-hover-opacity',
			'--md-state-focus': '--md-sys-state-focus-opacity',
			'--md-state-pressed': '--md-sys-state-pressed-opacity',
			'--md-state-dragged': '--md-sys-state-dragged-opacity',
			'--md-easing-standard': '--md-sys-motion-easing-standard',
			'--md-easing-emphasized-accelerate':
				'--md-sys-motion-easing-emphasized-accelerate',
			'--md-duration-short1': '--md-sys-motion-duration-short1',
			'--md-duration-medium2': '--md-sys-motion-duration-medium2',
			'--md-duration-long4': '--md-sys-motion-duration-long4',
		}
		for (const [fanName, sharedName] of Object.entries(aliases)) {
			expect(fan.get(fanName), fanName).toContain(`var(${sharedName})`)
		}
	})

	it('@spec components/infrastructure/fan/web/global/design-tokens "Colors stay per app"', () => {
		// The shared file carries only state and motion tokens: no color, type
		// or shape value that one app could change for the other.
		const shared = declarations(m3Sys)
		expect(shared.length).toBeGreaterThan(0)
		expect(shared.filter((d) => !SHARED_PREFIX.test(d.name))).toEqual([])

		// Each app declares its own surface, so a console value never reaches
		// the fan app's dark navy surface.
		const surfaceIn = (file: string) =>
			declarations(appCss[file]).find((d) => d.name === '--color-surface-base')
				?.value
		expect(surfaceIn('/src/styles/tokens.css')).toBe('oklch(18% 0.04 275deg)')
		expect(surfaceIn('/organizer/styles/main.css')).toBeDefined()
	})
})
