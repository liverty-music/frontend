// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { hueToPentatonicPitch } from './audio-engine'

const A4_HZ = 440
const PENTATONIC_PITCH_CLASSES = new Set([0, 2, 4, 7, 9])

/** Recover the nearest MIDI note from a frequency. */
function freqToMidi(freq: number): number {
	return Math.round(69 + 12 * Math.log2(freq / A4_HZ))
}

describe('hueToPentatonicPitch', () => {
	it('is deterministic — same hue yields the same pitch', () => {
		for (const hue of [0, 47, 123, 200, 333, 359]) {
			expect(hueToPentatonicPitch(hue)).toBe(hueToPentatonicPitch(hue))
		}
	})

	it('always lands on a major pentatonic scale degree across a full hue sweep', () => {
		for (let hue = 0; hue < 360; hue += 1) {
			const midi = freqToMidi(hueToPentatonicPitch(hue))
			const pitchClass = ((midi % 12) + 12) % 12
			expect(PENTATONIC_PITCH_CLASSES.has(pitchClass)).toBe(true)
		}
	})

	it('produces no dissonant interval between any two taps', () => {
		// Every interval between pentatonic degrees is consonant; assert that no
		// pair of pitches across the hue range forms a minor 2nd (1) or
		// tritone (6) semitone interval.
		const dissonant = new Set([1, 6, 11])
		const midis = Array.from({ length: 73 }, (_, i) =>
			freqToMidi(hueToPentatonicPitch(i * 5)),
		)
		for (let a = 0; a < midis.length; a++) {
			for (let b = a + 1; b < midis.length; b++) {
				const interval = Math.abs(midis[a] - midis[b]) % 12
				expect(dissonant.has(interval)).toBe(false)
			}
		}
	})

	it('maps hue monotonically upward in pitch', () => {
		expect(hueToPentatonicPitch(0)).toBeLessThanOrEqual(
			hueToPentatonicPitch(180),
		)
		expect(hueToPentatonicPitch(180)).toBeLessThanOrEqual(
			hueToPentatonicPitch(359),
		)
	})
})
