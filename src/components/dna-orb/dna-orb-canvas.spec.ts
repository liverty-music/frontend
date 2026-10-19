import { describe, expect, it } from 'vitest'
import type { PhysicsBubble } from './bubble-physics'
import {
	computeLabelLayout,
	nextFocusableIndex,
	wrapText,
} from './dna-orb-canvas'

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

/**
 * Width measure that depends on the font size, like a real canvas: Latin
 * ~0.6em, CJK ~1em, space ~0.3em.
 */
function fontMeasure(text: string, font: string): number {
	const size = Number(/bold ([\d.]+)px/.exec(font)?.[1] ?? 10)
	let em = 0
	for (const ch of text) {
		if (ch.charCodeAt(0) > 0x2fff) em += 1
		else if (ch === ' ') em += 0.3
		else em += 0.6
	}
	return em * size
}

/**
 * The per-frame label code before the layout was cached, transcribed with a
 * fake context: returns the font left on the context and the drawn lines.
 */
function oldRenderBubbleText(
	name: string,
	radius: number,
): { font: string; lines: string[]; lineHeight: number } {
	const ctx = {
		font: '',
		measureText: (t: string) => ({ width: fontMeasure(t, ctx.font) }),
	}
	const usableWidth = radius * 1.6
	const minFont = 10
	let fontSize = Math.max(minFont, radius * 0.38)
	const maxLines = 3
	let lines: string[]
	for (;;) {
		ctx.font = `bold ${fontSize}px system-ui, sans-serif`
		lines = wrapText(name, usableWidth, (t) => ctx.measureText(t).width)
		const allFit = lines.every(
			(line) => ctx.measureText(line).width <= usableWidth,
		)
		if ((allFit && lines.length <= maxLines) || fontSize <= minFont) break
		fontSize -= 0.5
	}
	if (lines.length > maxLines) lines = lines.slice(0, maxLines)
	return { font: ctx.font, lines, lineHeight: fontSize * 1.25 }
}

describe('computeLabelLayout parity with the per-frame label code', () => {
	const names = [
		'Milet',
		'Little Glee Monster',
		'go!go!vanillas',
		'The Pretty Reckless Of Many Words',
		'米津玄師',
		'ポルカドットスティングレイ',
		'あいみょん',
		'凛として時雨 TK',
		'King Gnu',
		'ずっと真夜中でいいのに。',
		'Mrs. GREEN APPLE',
		'',
	]
	const radii = [20, 26.4, 30, 33.33, 38.7, 45, 47.9]

	it('yields the same font, lines and line height for Latin, CJK and mixed names', () => {
		for (const name of names) {
			for (const r of radii) {
				expect(computeLabelLayout(name, r, fontMeasure)).toEqual(
					oldRenderBubbleText(name, r),
				)
			}
		}
	})
})

describe('computeLabelLayout cost', () => {
	it('measures far less text than the per-step shrink loop for a long name', () => {
		const name = 'The Pretty Reckless Of Many Words'
		let calls = 0
		const counted = (text: string, font: string) => {
			calls++
			return fontMeasure(text, font)
		}
		computeLabelLayout(name, 45, counted)
		const newCalls = calls

		// The old loop: wrap and re-measure at every 0.5 px step.
		let oldCalls = 0
		const usableWidth = 45 * 1.6
		for (let size = Math.max(10, 45 * 0.38); ; size -= 0.5) {
			const font = `bold ${size}px system-ui, sans-serif`
			const lines = wrapText(name, usableWidth, (t) => {
				oldCalls++
				return fontMeasure(t, font)
			})
			const fits =
				lines.every((l) => {
					oldCalls++
					return fontMeasure(l, font) <= usableWidth
				}) && lines.length <= 3
			if (fits || size <= 10) break
		}

		expect(newCalls).toBeLessThan(oldCalls / 2)
	})
})

describe('nextFocusableIndex', () => {
	function b(id: string, ghost = false): PhysicsBubble {
		return {
			artist: { id, name: id, mbid: '', isGhost: ghost || undefined },
			isFadingOut: false,
		} as PhysicsBubble
	}

	it('cycles forward and backward like before when no bubble is a ghost', () => {
		const bubbles = [b('a'), b('b'), b('c')]
		expect(nextFocusableIndex(bubbles, -1, 1)).toBe(0)
		expect(nextFocusableIndex(bubbles, 2, 1)).toBe(0)
		expect(nextFocusableIndex(bubbles, -1, -1)).toBe(2)
		expect(nextFocusableIndex(bubbles, 0, -1)).toBe(2)
	})

	it('skips ghost placeholders in the keyboard focus cycle', () => {
		const bubbles = [b('a'), b('g0', true), b('g1', true), b('c')]
		expect(nextFocusableIndex(bubbles, 0, 1)).toBe(3)
		expect(nextFocusableIndex(bubbles, 3, -1)).toBe(0)
	})

	it('returns -1 when only ghosts are on the field', () => {
		expect(nextFocusableIndex([b('g0', true)], -1, 1)).toBe(-1)
	})
})
