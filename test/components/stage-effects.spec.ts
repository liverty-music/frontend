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
		})

		it('should activate breathing at 1 follow', () => {
			const p = getStageParams(1)
			expect(p.orbRadius).toBe(68)
			expect(p.breathAmplitude).toBeGreaterThan(0)
			expect(p.orbitalCount).toBe(0)
			expect(p.particleVisibilityRatio).toBeGreaterThan(0.3)
		})

		it('should introduce orbitals and ground glow at 2 follows', () => {
			const p = getStageParams(2)
			expect(p.orbitalCount).toBe(2)
			expect(p.groundGlowAlpha).toBeGreaterThan(0)
		})

		it('should increase orbitals at 3 follows', () => {
			const p = getStageParams(3)
			expect(p.orbitalCount).toBe(4)
			expect(p.orbRadius).toBe(84)
		})

		it('should introduce light rays and comet trail at 4 follows', () => {
			const p = getStageParams(4)
			expect(p.lightRayCount).toBe(2)
			expect(p.cometTrailEnabled).toBe(true)
			expect(p.orbitalCount).toBe(6)
		})

		it('should enable shockwave at 5 follows', () => {
			const p = getStageParams(5)
			expect(p.shockwaveEnabled).toBe(true)
			expect(p.lightRayCount).toBe(4)
		})

		it('should reach full effects at 6 follows', () => {
			const p = getStageParams(6)
			expect(p.lightRayCount).toBe(6)
			expect(p.orbitalCount).toBe(10)
			expect(p.shockwaveEnabled).toBe(true)
			expect(p.cometTrailEnabled).toBe(true)
		})

		it('should use logarithmic growth beyond 6 follows', () => {
			const p6 = getStageParams(6)
			const p10 = getStageParams(10)
			expect(p10.orbRadius).toBeGreaterThan(p6.orbRadius)
			// Growth rate should slow down
			const delta6to10 = p10.orbRadius - p6.orbRadius
			const delta0to6 = p6.orbRadius - 60
			expect(delta6to10).toBeLessThan(delta0to6)
		})

		it('should still compute valid params at 20 follows', () => {
			const p = getStageParams(20)
			expect(p.orbRadius).toBeLessThanOrEqual(120)
			expect(p.orbitalCount).toBeLessThanOrEqual(12)
			expect(p.lightRayCount).toBeLessThanOrEqual(6)
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

		it('lightRayCount never exceeds 6', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).lightRayCount).toBeLessThanOrEqual(6)
			}
		})

		it('groundGlowAlpha never exceeds 0.2', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).groundGlowAlpha).toBeLessThanOrEqual(0.2)
			}
		})

		it('lightRayAlpha never exceeds 0.15', () => {
			for (let i = 0; i <= 50; i++) {
				expect(getStageParams(i).lightRayAlpha).toBeLessThanOrEqual(0.15)
			}
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
