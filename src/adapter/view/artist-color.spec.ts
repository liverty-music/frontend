// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { artistColor, artistHue } from './artist-color'

describe('artistHue', () => {
	it('returns same hue for same name', () => {
		expect(artistHue('Radiohead')).toBe(artistHue('Radiohead'))
	})

	it('returns value in 0-359 range', () => {
		const hue = artistHue('any artist name')
		expect(hue).toBeGreaterThanOrEqual(0)
		expect(hue).toBeLessThanOrEqual(359)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Per-artist bubble color differentiation"
	it('returns different hue for different names', () => {
		expect(artistHue('Radiohead')).not.toBe(artistHue('Coldplay'))
	})

	it('handles empty string without throwing', () => {
		const hue = artistHue('')
		expect(hue).toBeGreaterThanOrEqual(0)
		expect(hue).toBeLessThanOrEqual(359)
	})
})

describe('artistColor', () => {
	it('returns HSL string', () => {
		const color = artistColor('Radiohead')
		expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
	})

	it('returns HSL string for unicode input', () => {
		const color = artistColor('ビートルズ')
		expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
	})
})
