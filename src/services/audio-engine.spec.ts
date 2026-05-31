// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { glideStartFreq } from './audio-engine'

describe('glideStartFreq', () => {
	it('starts the drop above the target so the pop swoops downward', () => {
		for (const landing of [280, 440, 820, 1200]) {
			expect(glideStartFreq(landing)).toBeGreaterThan(landing)
		}
	})

	it('keeps the start strictly positive so an exponential ramp is valid', () => {
		// Web Audio's exponentialRampToValueAtTime requires a non-zero start.
		expect(glideStartFreq(820)).toBeGreaterThan(0)
	})

	it('is proportional to the target pitch (constant drop depth in cents)', () => {
		const ratio = glideStartFreq(880) / 880
		expect(glideStartFreq(440) / 440).toBeCloseTo(ratio)
	})
})
