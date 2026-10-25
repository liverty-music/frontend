import { describe, expect, it } from 'vitest'
import settingsListCss from '../../src/components/settings-list/settings-list.css?raw'
import successMarkCss from '../../src/components/success-mark/success-mark.css?raw'
import discoveryCss from '../../src/routes/discovery/discovery-route.css?raw'
import passkeyRecoveryCss from '../../src/routes/passkey-recovery/passkey-recovery-route.css?raw'
import languageSelectorCss from '../../src/routes/settings/language-selector.css?raw'
import tokensCss from '../../src/styles/tokens.css?raw'
import {
	contrast,
	type Oklch,
	oklabDistance,
	parseOklch,
} from '../helpers/oklch'

/**
 * Status colors are named by meaning (design-tokens "Status colors are named
 * by meaning"): the success value is checked against the colors it must not
 * be mistaken for, and each status mark is checked to use its meaning's token.
 */

function token(name: string): Oklch {
	const m = tokensCss.match(new RegExp(`${name}\\s*:\\s*(oklch\\([^)]*\\))`))
	if (!m) throw new Error(`${name} is not a literal oklch() token`)
	return parseOklch(m[1])
}

/** The first `color` declared in the block that `selector` opens. */
function colorOf(css: string, selector: string): string {
	const start = css.indexOf(`${selector} {`)
	if (start === -1) throw new Error(`no rule for ${selector}`)
	const block = css.slice(start, css.indexOf('}', start))
	const m = block.match(/(?:^|[\s;{])color:\s*([^;]+);/)
	if (!m) throw new Error(`${selector} declares no color`)
	return m[1].replace(/\s+/g, ' ').trim()
}

function journeyHue(status: string): number {
	const m = tokensCss.match(
		new RegExp(`--journey-hue-${status}\\s*:\\s*([\\d.]+)deg`),
	)
	if (!m) throw new Error(`--journey-hue-${status} is not a literal hue`)
	return Number(m[1])
}

const success = token('--color-success')

describe('success color', () => {
	it('@spec components/infrastructure/fan/web/global/design-tokens "Success is not the brand accent"', () => {
		for (const other of [
			'--color-brand-accent',
			'--color-stage-home',
			'--color-stage-near',
			'--color-stage-away',
		]) {
			expect(
				oklabDistance(success, token(other)),
				`--color-success to ${other}`,
			).toBeGreaterThanOrEqual(0.1)
		}
	})

	it('stays green', () => {
		expect(success.h).toBeGreaterThanOrEqual(120)
		expect(success.h).toBeLessThanOrEqual(170)
	})

	for (const surface of ['--color-surface-base', '--color-surface-raised']) {
		// The Settings badge colors its label text, so body text's 4.5:1 applies;
		// it also covers the 3:1 for icons and large text.
		it(`reaches 4.5:1 on ${surface}`, () => {
			expect(contrast(success, token(surface))).toBeGreaterThanOrEqual(4.5)
		})
	}
})

describe('status marks use the token of their meaning', () => {
	it('@spec components/infrastructure/fan/web/global/design-tokens "Done looks the same everywhere"', () => {
		const done = [
			// The /verify-email confirmation is the success mark.
			colorOf(successMarkCss, ':scope'),
			// Email and identity verification share the Settings badge.
			colorOf(
				settingsListCss,
				'.settings-verification-badge[data-verified="true"]',
			),
			colorOf(passkeyRecoveryCss, '.passkey-recovery-icon'),
		]
		for (const color of done) {
			expect(color).toBe('var(--color-success)')
		}
		// A paid ticket's journey node and filter chip take the success hue; each
		// sets its own lightness and chroma, as every journey status does.
		expect(journeyHue('paid')).toBe(success.h)
	})

	it('@spec components/infrastructure/fan/web/global/design-tokens "Selected is not shown as done"', () => {
		const selected = [
			colorOf(discoveryCss, '.followed-check'),
			colorOf(languageSelectorCss, '.language-check'),
		]
		for (const color of selected) {
			expect(color).toContain('var(--md-color-primary)')
			expect(color).not.toContain('success')
		}
	})
})
