// @vitest-environment node

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

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, 260)

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

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, 260)

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

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20, 260)

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

			animator.startAbsorption('id1', 'Artist', 100, 100, 200, 400, 20)
			expect(animator.isAnimating).toBe(true)
		})
	})

	describe('burst spray', () => {
		/**
		 * Minimal CanvasRenderingContext2D stand-in that records the center of
		 * every drawn arc plus every color string used (fillStyle assignments and
		 * gradient color stops), so we can assert burst droplets are painted at the
		 * tap point in the bubble's hue without a real canvas.
		 */
		function recordingCtx(): {
			ctx: CanvasRenderingContext2D
			arcs: Array<{ x: number; y: number }>
			colors: string[]
		} {
			const arcs: Array<{ x: number; y: number }> = []
			const colors: string[] = []
			const ctx = {
				set fillStyle(v: unknown) {
					if (typeof v === 'string') colors.push(v)
				},
				get fillStyle(): string {
					return ''
				},
				set strokeStyle(v: unknown) {
					if (typeof v === 'string') colors.push(v)
				},
				globalCompositeOperation: 'source-over',
				save() {},
				restore() {},
				beginPath() {},
				fill() {},
				stroke() {},
				arc(x: number, y: number) {
					arcs.push({ x, y })
				},
				createRadialGradient() {
					return {
						addColorStop(_stop: number, color: string) {
							colors.push(color)
						},
					}
				},
			} as unknown as CanvasRenderingContext2D
			return { ctx, arcs, colors }
		}

		it('sprays 15-20 droplets immediately on burst', () => {
			const animator = createAnimator()
			expect(animator.activeParticleCount).toBe(0)

			animator.spawnBurst(100, 200, 142)

			expect(animator.activeParticleCount).toBeGreaterThanOrEqual(15)
			expect(animator.activeParticleCount).toBeLessThanOrEqual(20)
		})

		it('paints luminous droplets at the tap point in the bubble hue', () => {
			const animator = createAnimator()
			animator.spawnBurst(100, 200, 142)

			const { ctx, arcs, colors } = recordingCtx()
			animator.render(ctx)

			// All droplets start at the tap point.
			expect(arcs.length).toBeGreaterThan(0)
			for (const a of arcs) {
				expect(a.x).toBe(100)
				expect(a.y).toBe(200)
			}

			// At least one painted color uses the bubble's hue (142) within the
			// +/-10 spawn variance, proving droplets carry the artist's color.
			const hues = colors
				.map((c) => c.match(/hsla\((\d+(?:\.\d+)?),/)?.[1])
				.filter((h): h is string => h !== undefined)
				.map(Number)
			expect(hues.length).toBeGreaterThan(0)
			expect(hues.some((h) => Math.abs(h - 142) <= 10)).toBe(true)

			// And a white-hot core is drawn for the glow.
			expect(colors.some((c) => c.startsWith('rgba(255, 255, 255'))).toBe(true)
		})

		it('is suppressed under reduced motion', () => {
			const animator = createAnimator()
			animator.reducedMotion = true

			animator.spawnBurst(100, 200, 142)

			expect(animator.activeParticleCount).toBe(0)
		})

		it('droplets expire after their lifetime elapses', () => {
			const animator = createAnimator()
			animator.spawnBurst(100, 200, 142)
			expect(animator.activeParticleCount).toBeGreaterThan(0)

			// Life decays at delta * 0.002 per tick; ~600ms fully expires them.
			for (let i = 0; i < 12; i++) animator.update(60)

			expect(animator.activeParticleCount).toBe(0)
		})
	})
})
