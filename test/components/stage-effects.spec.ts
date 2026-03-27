// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { getStageParams } from '../../src/components/dna-orb/stage-effects'

describe('getStageParams', () => {
	describe('boundary values', () => {
		it('should return base state at 0 follows', () => {
			const p = getStageParams(0)
			expect(p.level).toBe(0)
			expect(p.orbRadius).toBe(60)
			expect(p.orbitalCount).toBe(0)
			expect(p.lightRayCount).toBe(0)
			expect(p.groundGlowAlpha).toBe(0)
			expect(p.shockwaveEnabled).toBe(false)
			expect(p.cometTrailEnabled).toBe(false)
			expect(p.breathAmplitude).toBe(0)
			expect(p.nebulaLayerCount).toBe(0)
			expect(p.vortexTrailLength).toBe(0)
			expect(p.beatBPM).toBe(0)
			expect(p.strobeEnabled).toBe(false)
			expect(p.orbitalTailArc).toBe(0)
			expect(p.orbitalSize).toBe(2)
		})

		it('should activate breathing, orbitals and vortex at 1 follow', () => {
			const p = getStageParams(1)
			expect(p.orbRadius).toBe(72)
			expect(p.breathAmplitude).toBeGreaterThan(0)
			expect(p.orbitalCount).toBe(2)
			expect(p.particleVisibilityRatio).toBeGreaterThan(0.3)
			expect(p.groundGlowAlpha).toBeGreaterThan(0)
			expect(p.vortexTrailLength).toBe(2)
			expect(p.orbitalSize).toBe(4)
		})

		it('should introduce light rays, nebula, beat sync at 2 follows', () => {
			const p = getStageParams(2)
			expect(p.orbitalCount).toBe(5)
			expect(p.lightRayCount).toBe(2)
			expect(p.nebulaLayerCount).toBe(1)
			expect(p.beatBPM).toBeGreaterThan(0)
			expect(p.orbitalTailArc).toBeGreaterThan(0)
		})

		it('should enable shockwave, strobe, comet trail at 3 follows', () => {
			const p = getStageParams(3)
			expect(p.shockwaveEnabled).toBe(true)
			expect(p.cometTrailEnabled).toBe(true)
			expect(p.strobeEnabled).toBe(true)
			expect(p.vortexTrailLength).toBe(6)
			expect(p.lightRayCount).toBe(6)
		})

		it('should reach near-max at 4 follows', () => {
			const p = getStageParams(4)
			expect(p.nebulaLayerCount).toBe(3)
			expect(p.orbitalTailArc).toBe(45)
			expect(p.orbitalSize).toBe(8)
			expect(p.orbitalCount).toBe(11)
		})

		it('should reach full show at 5 follows', () => {
			const p = getStageParams(5)
			expect(p.lightRayCount).toBeGreaterThanOrEqual(12)
			expect(p.orbitalCount).toBe(12)
			expect(p.beatBPM).toBe(2.0)
			expect(p.lightRayAlpha).toBeGreaterThanOrEqual(0.35)
			expect(p.shockwaveEnabled).toBe(true)
			expect(p.cometTrailEnabled).toBe(true)
			expect(p.strobeEnabled).toBe(true)
		})

		it('should cap at full show values for 6+ follows', () => {
			const p5 = getStageParams(5)
			const p6 = getStageParams(6)
			expect(p6.lightRayCount).toBe(p5.lightRayCount)
			expect(p6.orbitalCount).toBe(p5.orbitalCount)
			expect(p6.beatBPM).toBe(p5.beatBPM)
			expect(p6.nebulaLayerCount).toBe(p5.nebulaLayerCount)
			expect(p6.orbitalTailArc).toBe(p5.orbitalTailArc)
			expect(p6.orbitalSize).toBe(p5.orbitalSize)
		})

		it('should use logarithmic growth beyond 5 follows', () => {
			const p4 = getStageParams(4)
			const p5 = getStageParams(5)
			// Linear growth through follow 5
			expect(p5.orbRadius).toBeGreaterThan(p4.orbRadius)
			// At follow 5, orbRadius hits the cap (120), so 6+ stays capped
			const p10 = getStageParams(10)
			expect(p10.orbRadius).toBeLessThanOrEqual(120)
		})

		it('should still compute valid params at 20 follows', () => {
			const p = getStageParams(20)
			expect(p.orbRadius).toBeLessThanOrEqual(120)
			expect(p.orbitalCount).toBeLessThanOrEqual(12)
			expect(p.lightRayCount).toBeLessThanOrEqual(14)
		})
	})

	describe('monotonic growth', () => {
		const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20]
		const params = counts.map((c) => getStageParams(c))

		it('orbRadius is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].orbRadius).toBeGreaterThanOrEqual(
					params[i - 1].orbRadius,
				)
			}
		})

		it('orbitalCount is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].orbitalCount).toBeGreaterThanOrEqual(
					params[i - 1].orbitalCount,
				)
			}
		})

		it('lightRayCount is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].lightRayCount).toBeGreaterThanOrEqual(
					params[i - 1].lightRayCount,
				)
			}
		})

		it('groundGlowAlpha is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].groundGlowAlpha).toBeGreaterThanOrEqual(
					params[i - 1].groundGlowAlpha,
				)
			}
		})

		it('nebulaLayerCount is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].nebulaLayerCount).toBeGreaterThanOrEqual(
					params[i - 1].nebulaLayerCount,
				)
			}
		})

		it('orbitalTailArc is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].orbitalTailArc).toBeGreaterThanOrEqual(
					params[i - 1].orbitalTailArc,
				)
			}
		})

		it('orbitalSize is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].orbitalSize).toBeGreaterThanOrEqual(
					params[i - 1].orbitalSize,
				)
			}
		})

		it('beatBPM is non-decreasing', () => {
			for (let i = 1; i < params.length; i++) {
				expect(params[i].beatBPM).toBeGreaterThanOrEqual(params[i - 1].beatBPM)
			}
		})
	})

	describe('ceiling assertions', () => {
		it('orbRadius never exceeds 120', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).orbRadius).toBeLessThanOrEqual(120)
			}
		})

		it('orbitalCount never exceeds 12', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).orbitalCount).toBeLessThanOrEqual(12)
			}
		})

		it('lightRayCount never exceeds 14', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).lightRayCount).toBeLessThanOrEqual(14)
			}
		})

		it('groundGlowAlpha never exceeds 0.2', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).groundGlowAlpha).toBeLessThanOrEqual(0.2)
			}
		})

		it('lightRayAlpha never exceeds 0.4', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).lightRayAlpha).toBeLessThanOrEqual(0.4)
			}
		})

		it('nebulaLayerCount never exceeds 3', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).nebulaLayerCount).toBeLessThanOrEqual(3)
			}
		})

		it('nebulaAlpha never exceeds 0.25', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).nebulaAlpha).toBeLessThanOrEqual(0.25)
			}
		})

		it('orbitalTailArc never exceeds 45', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).orbitalTailArc).toBeLessThanOrEqual(45)
			}
		})

		it('orbitalSize never exceeds 8', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).orbitalSize).toBeLessThanOrEqual(8)
			}
		})

		it('beatBPM never exceeds 2.0', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).beatBPM).toBeLessThanOrEqual(2.0)
			}
		})
	})

	describe('full show at follow 5', () => {
		it('follow 5 and follow 6 should have same capped values', () => {
			const p5 = getStageParams(5)
			const p6 = getStageParams(6)

			expect(p6.orbitalCount).toBe(p5.orbitalCount)
			expect(p6.lightRayCount).toBe(p5.lightRayCount)
			expect(p6.beatBPM).toBe(p5.beatBPM)
			expect(p6.nebulaLayerCount).toBe(p5.nebulaLayerCount)
			expect(p6.orbitalTailArc).toBe(p5.orbitalTailArc)
			expect(p6.orbitalSize).toBe(p5.orbitalSize)
			expect(p6.lightRayAlpha).toBe(p5.lightRayAlpha)
			expect(p6.vortexTrailLength).toBe(p5.vortexTrailLength)
		})
	})

	describe('determinism', () => {
		it('should return identical results for the same input', () => {
			const a = getStageParams(5)
			const b = getStageParams(5)
			expect(a).toEqual(b)
		})
	})
})
