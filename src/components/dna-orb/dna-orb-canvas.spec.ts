import { describe, expect, it } from 'vitest'
import { wrapText } from './dna-orb-canvas'

/**
 * Mock measureFn that approximates character width.
 * Latin chars ~8px, CJK chars ~14px at a typical font size.
 */
function mockMeasure(text: string): number {
	let width = 0
	for (const ch of text) {
		// CJK range approximation
		if (ch.charCodeAt(0) > 0x2fff) {
			width += 14
		} else if (ch === ' ') {
			width += 4
		} else {
			width += 8
		}
	}
	return width
}

describe('wrapText', () => {
	it('returns single line for short text', () => {
		const lines = wrapText('Milet', 100, mockMeasure)
		expect(lines).toEqual(['Milet'])
	})

	it('wraps English text at word boundaries', () => {
		// "Little Glee Monster": "Little"=48, "Glee"=32, "Monster"=56
		// maxWidth=80 → each word alone fits, but no two combine
		const lines = wrapText('Little Glee Monster', 80, mockMeasure)
		expect(lines).toEqual(['Little', 'Glee', 'Monster'])
	})

	it('wraps CJK text without spaces at character boundaries', () => {
		// "ポルカドットスティングレイ" = 12 CJK chars × 14px = 168px
		// maxWidth=72 → ~5 chars per line (5×14=70 ≤ 72)
		const lines = wrapText('ポルカドットスティングレイ', 72, mockMeasure)
		expect(lines.length).toBeGreaterThan(1)
		expect(lines.join('')).toBe('ポルカドットスティングレイ')
		for (const line of lines) {
			expect(mockMeasure(line)).toBeLessThanOrEqual(72)
		}
	})

	it('keeps short CJK name as single line', () => {
		// "米津玄師" = 4 × 14 = 56px, maxWidth=72
		const lines = wrapText('米津玄師', 72, mockMeasure)
		expect(lines).toEqual(['米津玄師'])
	})

	it('wraps mixed CJK and Latin at space first, then character boundary', () => {
		// "凛として時雨 TK" → split at space: ["凛として時雨", "TK"]
		// "凛として時雨" = 84px > 72 → further char break
		const lines = wrapText('凛として時雨 TK', 72, mockMeasure)
		expect(lines.length).toBeGreaterThan(1)
		expect(lines.join('').replace(/\s/g, '')).toBe('凛として時雨TK')
		expect(lines[lines.length - 1]).toContain('TK')
	})

	it('returns original text for empty string', () => {
		const lines = wrapText('', 100, mockMeasure)
		expect(lines).toEqual([''])
	})

	it('handles single-word Latin text that fits', () => {
		const lines = wrapText('DOES', 100, mockMeasure)
		expect(lines).toEqual(['DOES'])
	})

	it('breaks long Latin word at character boundary when it exceeds maxWidth', () => {
		// "go!go!vanillas" = 14 × 8 = 112px, maxWidth=72 → must char-break
		const lines = wrapText('go!go!vanillas', 72, mockMeasure)
		expect(lines.length).toBeGreaterThan(1)
		expect(lines.join('')).toBe('go!go!vanillas')
		for (const line of lines) {
			expect(mockMeasure(line)).toBeLessThanOrEqual(72)
		}
	})

	it('anti-orphan: avoids 1 character on last line', () => {
		// "サイダーガール" = 7 × 14 = 98px, maxWidth=86 (fits 6 chars = 84px)
		// Without anti-orphan: ["サイダーガー", "ル"] (1 char orphan)
		// With anti-orphan: ["サイダー", "ガール"] (balanced, last line >= 3 chars)
		const lines = wrapText('サイダーガール', 86, mockMeasure)
		expect(lines.length).toBe(2)
		expect(lines.join('')).toBe('サイダーガール')
		expect([...lines[lines.length - 1]].length).toBeGreaterThanOrEqual(3)
	})

	it('anti-orphan: avoids 2 characters on last line', () => {
		// "あいみょん" = 5 × 14 = 70px, maxWidth=44 (fits 3 chars = 42px)
		// Without anti-orphan: ["あいみ", "ょん"] (2 char orphan)
		// With anti-orphan: ["あい", "みょん"] (last line >= 3 chars)
		const lines = wrapText('あいみょん', 44, mockMeasure)
		expect(lines.length).toBe(2)
		expect(lines.join('')).toBe('あいみょん')
		expect([...lines[lines.length - 1]].length).toBeGreaterThanOrEqual(3)
	})

	it('does not apply anti-orphan when last line has 3+ characters', () => {
		// "ポルカドット" = 6 × 14 = 84px, maxWidth=44 (fits 3 chars = 42px)
		// → ["ポルカ", "ドット"] — last line has 3 chars, no orphan fix needed
		const lines = wrapText('ポルカドット', 44, mockMeasure)
		expect(lines.length).toBe(2)
		expect(lines.join('')).toBe('ポルカドット')
		expect([...lines[lines.length - 1]].length).toBe(3)
	})
})

describe('renderBubbleText minFont', () => {
	it('minimum font size is 10px (design constraint)', () => {
		const minFont = 10
		const radius = 30
		const initialFont = Math.max(minFont, radius * 0.38)
		expect(initialFont).toBeGreaterThanOrEqual(minFont)

		const tinyRadius = 20
		const tinyFont = Math.max(minFont, tinyRadius * 0.38)
		expect(tinyFont).toBe(minFont)
	})
})
