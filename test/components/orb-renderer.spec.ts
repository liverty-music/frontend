import { describe, expect, it } from 'vitest'
import { OrbRenderer } from '../../src/components/dna-orb/orb-renderer'

describe('OrbRenderer', () => {
	function createRenderer(): OrbRenderer {
		const renderer = new OrbRenderer()
		renderer.init(400, 600)
		return renderer
	}

	describe('injectColor', () => {
		it('should inject particles with the given hue while keeping total at maxParticles', () => {
			const renderer = createRenderer()

			renderer.injectColor(142)

			// Access particles via type assertion for testing
			const particles = (
				renderer as unknown as { particles: { hue: number }[] }
			).particles
			expect(particles.length).toBe(60) // maxParticles unchanged

			// At least 5 particles should have hue near 142 (±10)
			const injected = particles.filter((p) => p.hue >= 132 && p.hue <= 152)
			expect(injected.length).toBeGreaterThanOrEqual(5)
		})

		it('should set swirlIntensity to 1.0 after injectColor', () => {
			const renderer = createRenderer()

			renderer.injectColor(200)

			expect(renderer.swirlIntensity).toBe(1.0)
		})
	})

	describe('swirlIntensity decay', () => {
		it('should decay swirlIntensity to 0 after sufficient update calls', () => {
			const renderer = createRenderer()

			renderer.injectColor(100)
			expect(renderer.swirlIntensity).toBe(1.0)

			// Simulate 1200ms of updates (should decay fully from 1.0 over 1000ms)
			for (let i = 0; i < 12; i++) {
				renderer.update(100)
			}

			expect(renderer.swirlIntensity).toBe(0)
		})
	})

	describe('setFollowCount / baseIntensity', () => {
		it('should return 0 for count 0', () => {
			const renderer = createRenderer()
			renderer.setFollowCount(0)
			expect(renderer.baseIntensity).toBe(0)
		})

		it('should follow diminishing-returns curve 1 - 1/(1 + count*0.5)', () => {
			const renderer = createRenderer()

			renderer.setFollowCount(1)
			expect(renderer.baseIntensity).toBeCloseTo(1 - 1 / 1.5, 10)

			renderer.setFollowCount(2)
			expect(renderer.baseIntensity).toBeCloseTo(1 - 1 / 2, 10)

			renderer.setFollowCount(5)
			expect(renderer.baseIntensity).toBeCloseTo(1 - 1 / 3.5, 10)

			renderer.setFollowCount(10)
			expect(renderer.baseIntensity).toBeCloseTo(1 - 1 / 6, 10)
		})

		it('should asymptotically approach 1 for large counts', () => {
			const renderer = createRenderer()
			renderer.setFollowCount(100)
			expect(renderer.baseIntensity).toBeGreaterThan(0.95)
			expect(renderer.baseIntensity).toBeLessThan(1)
		})

		it('should influence swirlMultiplier in update()', () => {
			const renderer = createRenderer()

			// Without baseIntensity, particles move at base speed
			const p0Angle = (
				renderer as unknown as { particles: { angle: number }[] }
			).particles[0].angle
			renderer.update(100)
			const deltaNoBase =
				(renderer as unknown as { particles: { angle: number }[] }).particles[0]
					.angle - p0Angle

			// Reset and apply baseIntensity
			const renderer2 = createRenderer()
			renderer2.setFollowCount(5)
			const p0Angle2 = (
				renderer2 as unknown as { particles: { angle: number }[] }
			).particles[0].angle
			renderer2.update(100)
			const deltaWithBase =
				(renderer2 as unknown as { particles: { angle: number }[] })
					.particles[0].angle - p0Angle2

			// With baseIntensity, particles should move faster
			expect(Math.abs(deltaWithBase)).toBeGreaterThan(Math.abs(deltaNoBase))
		})
	})

	describe('multiple rapid injectColor calls', () => {
		it('should inject each hue and restart swirl', () => {
			const renderer = createRenderer()

			renderer.injectColor(100)
			renderer.update(200) // Decay swirl partially
			expect(renderer.swirlIntensity).toBeLessThan(1.0)

			renderer.injectColor(300)
			// Swirl should restart at 1.0
			expect(renderer.swirlIntensity).toBe(1.0)

			const particles = (
				renderer as unknown as { particles: { hue: number }[] }
			).particles
			// Should have particles near both 100 and 300
			const near100 = particles.filter((p) => p.hue >= 90 && p.hue <= 110)
			const near300 = particles.filter((p) => p.hue >= 290 && p.hue <= 310)
			expect(near100.length + near300.length).toBeGreaterThanOrEqual(5)
		})
	})
})
