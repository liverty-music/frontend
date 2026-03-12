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
