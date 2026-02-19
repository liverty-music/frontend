import { describe, expect, it } from 'vitest'
import { artistColor } from '../../../src/components/live-highway/color-generator'

describe('artistColor', () => {
	it('should return a valid HSL color string', () => {
		const color = artistColor('Artist Name')
		expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
	})

	it('should produce the same color for the same artist name (deterministic)', () => {
		const name = 'Radiohead'
		const color1 = artistColor(name)
		const color2 = artistColor(name)
		expect(color1).toBe(color2)
	})

	it('should produce different colors for different artist names', () => {
		const color1 = artistColor('The Beatles')
		const color2 = artistColor('Pink Floyd')
		// Extract hue values from HSL strings
		const hue1 = Number.parseInt(color1.match(/^hsl\((\d+),/)?.[1] ?? '0', 10)
		const hue2 = Number.parseInt(color2.match(/^hsl\((\d+),/)?.[1] ?? '0', 10)
		expect(hue1).not.toBe(hue2)
	})

	it('should handle empty string without throwing', () => {
		expect(() => artistColor('')).not.toThrow()
		const color = artistColor('')
		expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
	})

	it('should handle single character names', () => {
		const color = artistColor('A')
		expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
	})

	it('should handle unicode characters', () => {
		const color = artistColor('ビートルズ')
		expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/)
	})
})
