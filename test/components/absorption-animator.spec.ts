import { describe, expect, it } from 'vitest'
import { AbsorptionAnimator } from '../../src/components/dna-orb/absorption-animator'

describe('AbsorptionAnimator', () => {
	function createAnimator(): AbsorptionAnimator {
		return new AbsorptionAnimator()
	}

	describe('comet trail buffer', () => {
		it('should accumulate trail points when cometTrailEnabled is true', () => {
			const animator = createAnimator()
			animator.cometTrailEnabled = true

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, '', 260)

			// Simulate 20 frames
			for (let i = 0; i < 20; i++) {
				animator.update(16)
			}

			// Trail should be capped at 12
			expect(animator.getTrailLength(0)).toBeLessThanOrEqual(12)
			expect(animator.getTrailLength(0)).toBeGreaterThan(0)
		})

		it('should cap trail buffer at 12 entries', () => {
			const animator = createAnimator()
			animator.cometTrailEnabled = true

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, '', 260)

			// Simulate many frames (but not enough to complete)
			for (let i = 0; i < 30; i++) {
				animator.update(10)
			}

			// Should still be animating and trail capped
			if (animator.animationCount > 0) {
				expect(animator.getTrailLength(0)).toBeLessThanOrEqual(12)
			}
		})

		it('should not accumulate trail points when cometTrailEnabled is false', () => {
			const animator = createAnimator()
			animator.cometTrailEnabled = false

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, '', 260)

			for (let i = 0; i < 20; i++) {
				animator.update(16)
			}

			if (animator.animationCount > 0) {
				expect(animator.getTrailLength(0)).toBe(0)
			}
		})
	})

	describe('absorption lifecycle', () => {
		it('should call onComplete when animation finishes', () => {
			const animator = createAnimator()
			let completedHue = -1

			animator.startAbsorption(
				'id1',
				'Artist',
				100,
				100,
				200,
				400,
				20,
				'',
				180,
				(hue) => {
					completedHue = hue
				},
			)

			// Run until completion (~667ms at delta * 0.0015)
			for (let i = 0; i < 100; i++) {
				animator.update(16)
			}

			expect(completedHue).toBe(180)
			expect(animator.animationCount).toBe(0)
		})

		it('should report isAnimating correctly', () => {
			const animator = createAnimator()
			expect(animator.isAnimating).toBe(false)

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, '')
			expect(animator.isAnimating).toBe(true)
		})
	})
})
