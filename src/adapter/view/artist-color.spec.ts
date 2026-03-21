import { describe, expect, it } from 'vitest'
import {
	artistColor,
	artistHue,
	artistHueFromColorProfile,
} from './artist-color'

describe('artistHue', () => {
	it('returns same hue for same name', () => {
		expect(artistHue('Radiohead')).toBe(artistHue('Radiohead'))
	})

	it('returns value in 0-359 range', () => {
		const hue = artistHue('any artist name')
		expect(hue).toBeGreaterThanOrEqual(0)
		expect(hue).toBeLessThanOrEqual(359)
	})

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

describe('artistHueFromColorProfile', () => {
	it('returns complementary hue for chromatic profile (120° → 300°)', () => {
		const profile = {
			isChromatic: true,
			dominantHue: 120,
			dominantLightness: 50,
		}
		expect(artistHueFromColorProfile(profile, 'Radiohead')).toBe(300)
	})

	it('returns complementary hue for pink logo (335° → 155°)', () => {
		const profile = {
			isChromatic: true,
			dominantHue: 335,
			dominantLightness: 75,
		}
		expect(artistHueFromColorProfile(profile, 'YOASOBI')).toBe(155)
	})

	it('returns complementary hue for red logo (29° → 209°)', () => {
		const profile = {
			isChromatic: true,
			dominantHue: 29,
			dominantLightness: 63,
		}
		expect(artistHueFromColorProfile(profile, 'Artist')).toBe(209)
	})

	it('returns complementary hue for blue logo (260° → 80°)', () => {
		const profile = {
			isChromatic: true,
			dominantHue: 260,
			dominantLightness: 45,
		}
		expect(artistHueFromColorProfile(profile, 'Artist')).toBe(80)
	})

	it('treats dominantHue 0 as valid — complementary is 180°', () => {
		const profile = {
			isChromatic: true,
			dominantHue: 0,
			dominantLightness: 50,
		}
		expect(artistHueFromColorProfile(profile, 'Radiohead')).toBe(180)
	})

	it('falls back to name hash for achromatic profile', () => {
		const profile = {
			isChromatic: false,
			dominantHue: 120,
			dominantLightness: 50,
		}
		expect(artistHueFromColorProfile(profile, 'Radiohead')).toBe(
			artistHue('Radiohead'),
		)
	})

	it('falls back to name hash for undefined profile', () => {
		expect(artistHueFromColorProfile(undefined, 'Radiohead')).toBe(
			artistHue('Radiohead'),
		)
	})
})
