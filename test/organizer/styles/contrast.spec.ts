import { describe, expect, it } from 'vitest'
import tokensCss from '../../../organizer/styles/tokens.css?raw'

/**
 * Computes the contrast of every console color role pair in light and in dark
 * from organizer/styles/tokens.css. Each role is a `light-dark()` of two literal
 * `oklch()` colors, so the check needs no browser.
 */

type Theme = 'light' | 'dark'
interface Oklch {
	l: number
	c: number
	h: number
	alpha: number
}

function parseOklch(text: string): Oklch {
	const m = text.match(
		/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)deg(?:\s*\/\s*([\d.]+)%)?\s*\)/,
	)
	if (!m) throw new Error(`not a literal oklch(): ${text}`)
	return {
		l: Number(m[1]) / 100,
		c: Number(m[2]),
		h: Number(m[3]),
		alpha: m[4] === undefined ? 1 : Number(m[4]) / 100,
	}
}

/** Role name → its light and dark color, read from the token file. */
function readRoles(css: string): Map<string, Record<Theme, Oklch>> {
	const roles = new Map<string, Record<Theme, Oklch>>()
	const flat = css.replace(/\s+/g, ' ')
	for (const m of flat.matchAll(/(--md-color-[\w-]+)\s*:\s*([^;]+);/g)) {
		const value = m[2].trim()
		const pair = value.match(
			/^light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)$/,
		)
		if (pair) {
			roles.set(m[1], { light: parseOklch(pair[1]), dark: parseOklch(pair[2]) })
		} else {
			const single = parseOklch(value)
			roles.set(m[1], { light: single, dark: single })
		}
	}
	return roles
}

/** OKLCH → linear sRGB, clipped to the sRGB gamut. */
function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
	const rad = (h * Math.PI) / 180
	const a = c * Math.cos(rad)
	const b = c * Math.sin(rad)
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	const clip = (v: number) => Math.min(1, Math.max(0, v))
	return [
		clip(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
		clip(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
		clip(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
	]
}

function luminance(color: Oklch): number {
	const [r, g, b] = toLinearSrgb(color)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: Oklch, bg: Oklch): number {
	const a = luminance(fg)
	const b = luminance(bg)
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const SURFACES = [
	'surface',
	'surface-container-low',
	'surface-container',
	'surface-container-high',
	'surface-container-highest',
]

/** Text pairs: body text needs 4.5:1. */
const TEXT_PAIRS: Array<[string, string]> = [
	...SURFACES.flatMap(
		(bg): Array<[string, string]> => [
			['on-surface', bg],
			['on-surface-variant', bg],
			// Text buttons and links.
			['primary', bg],
			// Field errors and error text.
			['error', bg],
		],
	),
	['on-primary', 'primary'],
	['on-primary-container', 'primary-container'],
	['on-secondary-container', 'secondary-container'],
	['on-error', 'error'],
	['on-error-container', 'error-container'],
	['on-success-container', 'success-container'],
	['on-warning-container', 'warning-container'],
	['on-neutral-container', 'neutral-container'],
	['inverse-on-surface', 'inverse-surface'],
	['inverse-primary', 'inverse-surface'],
]

/** Non-text pairs: icons, control boundaries and the focus ring need 3:1. */
const UI_PAIRS: Array<[string, string]> = SURFACES.flatMap(
	(bg): Array<[string, string]> => [
		['outline', bg],
		['primary', bg],
		['success', bg],
		['warning', bg],
		['error', bg],
	],
)

const roles = readRoles(tokensCss)

function role(name: string, theme: Theme): Oklch {
	const r = roles.get(`--md-color-${name}`)
	if (!r) throw new Error(`role --md-color-${name} is not defined`)
	return r[theme]
}

describe('console color roles', () => {
	it('defines every role with a light and a dark value', () => {
		const single = [...roles.entries()]
			.filter(([, v]) => v.light === v.dark)
			.map(([k]) => k)
		// Only the scrim is the same in both themes.
		expect(single).toEqual(['--md-color-scrim'])
	})

	for (const theme of ['light', 'dark'] as const) {
		it(`text pairs reach 4.5:1 in ${theme}`, () => {
			const failing = TEXT_PAIRS.map(([fg, bg]) => ({
				pair: `${fg} on ${bg}`,
				ratio: contrast(role(fg, theme), role(bg, theme)),
			})).filter((p) => p.ratio < 4.5)
			expect(failing).toEqual([])
		})

		it(`icons and control boundaries reach 3:1 in ${theme}`, () => {
			const failing = UI_PAIRS.map(([fg, bg]) => ({
				pair: `${fg} on ${bg}`,
				ratio: contrast(role(fg, theme), role(bg, theme)),
			})).filter((p) => p.ratio < 3)
			expect(failing).toEqual([])
		})
	}

	it('@spec components/infrastructure/organizer/web/global/design-tokens "Secondary text on a card"', () => {
		// A card is a surface-container; its secondary line is on-surface-variant.
		for (const theme of ['light', 'dark'] as const) {
			expect(
				contrast(
					role('on-surface-variant', theme),
					role('surface-container', theme),
				),
			).toBeGreaterThanOrEqual(4.5)
		}
	})

	it('surfaces are light in light and dark in dark, with text on the other end', () => {
		expect(role('surface', 'light').l).toBeGreaterThan(0.9)
		expect(role('on-surface', 'light').l).toBeLessThan(0.3)
		expect(role('surface', 'dark').l).toBeLessThan(0.25)
		expect(role('on-surface', 'dark').l).toBeGreaterThan(0.9)
	})
})
