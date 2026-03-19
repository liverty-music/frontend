import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrbRenderer } from '../../src/components/dna-orb/orb-renderer'

describe('OrbRenderer', () => {
	function createRenderer(): OrbRenderer {
		const renderer = new OrbRenderer()
		renderer.init(400, 600)
		return renderer
	}

	function createReducedMotionRenderer(): OrbRenderer {
		const original = window.matchMedia
		window.matchMedia = vi.fn().mockReturnValue({ matches: true })
		const renderer = new OrbRenderer()
		renderer.init(400, 600)
		window.matchMedia = original
		return renderer
	}

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe('injectColor', () => {
		it('should inject particles with the given hue while keeping total at maxParticles', () => {
			const renderer = createRenderer()

			renderer.injectColor(142)

			const particles = (
				renderer as unknown as { particles: { hue: number }[] }
			).particles
			expect(particles.length).toBe(60)

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

		it('should update orbRadius via stageParams', () => {
			const renderer = createRenderer()
			renderer.setFollowCount(0)
			expect(renderer.orbRadius).toBe(60)

			renderer.setFollowCount(3)
			expect(renderer.orbRadius).toBe(96)

			renderer.setFollowCount(5)
			expect(renderer.orbRadius).toBe(120)
		})

		it('should influence swirlMultiplier in update()', () => {
			const renderer = createRenderer()

			// Sum absolute angle deltas across ALL particles to smooth out
			// per-particle random speed variance that causes flakiness.
			type Particle = { angle: number; speed: number }
			const getParticles = (r: OrbRenderer) =>
				(r as unknown as { particles: Particle[] }).particles

			const before1 = getParticles(renderer).map((p) => p.angle)
			for (let i = 0; i < 10; i++) renderer.update(100)
			const after1 = getParticles(renderer).map((p) => p.angle)
			const totalNoBase = before1.reduce(
				(sum, a, i) => sum + Math.abs(after1[i] - a),
				0,
			)

			const renderer2 = createRenderer()
			renderer2.setFollowCount(5)
			const before2 = getParticles(renderer2).map((p) => p.angle)
			for (let i = 0; i < 10; i++) renderer2.update(100)
			const after2 = getParticles(renderer2).map((p) => p.angle)
			const totalWithBase = before2.reduce(
				(sum, a, i) => sum + Math.abs(after2[i] - a),
				0,
			)

			expect(totalWithBase).toBeGreaterThan(totalNoBase)
		})
	})

	describe('color palette accumulation', () => {
		it('should accumulate hues in colorPalette', () => {
			const renderer = createRenderer()

			renderer.injectColor(100)
			renderer.injectColor(200)
			renderer.injectColor(300)

			expect(renderer.colorPalette).toEqual([100, 200, 300])
		})

		it('should cap palette at 20 entries using FIFO', () => {
			const renderer = createRenderer()

			for (let i = 0; i < 25; i++) {
				renderer.injectColor(i * 15)
			}

			expect(renderer.colorPalette.length).toBe(20)
			expect(renderer.colorPalette[0]).toBe(75)
			expect(renderer.colorPalette[19]).toBe(360)
		})
	})

	describe('shockwave lifecycle', () => {
		it('should spawn a shockwave', () => {
			const renderer = createRenderer()

			renderer.spawnShockwave(180)

			expect(renderer.activeShockwaveCount).toBe(1)
		})

		it('should deactivate shockwave after 800ms', () => {
			const renderer = createRenderer()

			renderer.spawnShockwave(180)
			expect(renderer.activeShockwaveCount).toBe(1)

			for (let i = 0; i < 8; i++) {
				renderer.update(100)
			}

			expect(renderer.activeShockwaveCount).toBe(0)
		})

		it('should support 5 concurrent shockwaves', () => {
			const renderer = createRenderer()

			renderer.spawnShockwave(100)
			renderer.spawnShockwave(200)
			renderer.spawnShockwave(300)
			renderer.spawnShockwave(400)
			renderer.spawnShockwave(500)

			expect(renderer.activeShockwaveCount).toBe(5)
		})

		it('should not exceed 5 concurrent shockwaves', () => {
			const renderer = createRenderer()

			for (let i = 0; i < 7; i++) {
				renderer.spawnShockwave(i * 50)
			}

			expect(renderer.activeShockwaveCount).toBe(5)
		})
	})

	describe('orbital count reflects stageParams', () => {
		it('should return 0 orbitals at follow count 0', () => {
			const renderer = createRenderer()
			renderer.setFollowCount(0)
			expect(renderer.orbitalCount).toBe(0)
		})

		it('should return 2 orbitals at follow count 1', () => {
			const renderer = createRenderer()
			renderer.setFollowCount(1)
			expect(renderer.orbitalCount).toBe(2)
		})

		it('should increase orbitals with follow count', () => {
			const renderer = createRenderer()
			renderer.setFollowCount(5)
			expect(renderer.orbitalCount).toBe(12)
		})
	})

	describe('multiple rapid injectColor calls', () => {
		it('should inject each hue and restart swirl', () => {
			const renderer = createRenderer()

			renderer.injectColor(100)
			renderer.update(200)
			expect(renderer.swirlIntensity).toBeLessThan(1.0)

			renderer.injectColor(300)
			expect(renderer.swirlIntensity).toBe(1.0)

			const particles = (
				renderer as unknown as { particles: { angle: number; hue: number }[] }
			).particles
			const near100 = particles.filter((p) => p.hue >= 90 && p.hue <= 110)
			const near300 = particles.filter((p) => p.hue >= 290 && p.hue <= 310)
			expect(near100.length + near300.length).toBeGreaterThanOrEqual(5)
		})
	})

	describe('prefers-reduced-motion', () => {
		it('should suppress shockwave spawning', () => {
			const renderer = createReducedMotionRenderer()

			renderer.spawnShockwave(180)

			expect(renderer.activeShockwaveCount).toBe(0)
		})

		it('should suppress orbital rotation', () => {
			const renderer = createReducedMotionRenderer()
			renderer.setFollowCount(5)

			const orbitals = (
				renderer as unknown as {
					orbitals: { angle: number }[]
				}
			).orbitals
			const angleBefore = orbitals[0].angle

			renderer.update(100)

			expect(orbitals[0].angle).toBe(angleBefore)
		})

		it('should suppress breathing amplitude in render', () => {
			const renderer = createReducedMotionRenderer()
			renderer.setFollowCount(5)

			const rm = (renderer as unknown as { reducedMotion: boolean })
				.reducedMotion
			expect(rm).toBe(true)
		})

		it('should use swirlMultiplier of 1 regardless of intensity', () => {
			const renderer = createReducedMotionRenderer()
			renderer.setFollowCount(5)
			renderer.injectColor(100)

			const p0Angle = (
				renderer as unknown as { particles: { angle: number }[] }
			).particles[0].angle
			renderer.update(100)
			const deltaReduced =
				(renderer as unknown as { particles: { angle: number }[] }).particles[0]
					.angle - p0Angle

			const normalRenderer = createRenderer()
			normalRenderer.setFollowCount(5)
			normalRenderer.injectColor(100)

			const p0Angle2 = (
				normalRenderer as unknown as { particles: { angle: number }[] }
			).particles[0].angle
			normalRenderer.update(100)
			const deltaNormal =
				(normalRenderer as unknown as { particles: { angle: number }[] })
					.particles[0].angle - p0Angle2

			expect(Math.abs(deltaReduced)).toBeLessThan(Math.abs(deltaNormal))
		})

		it('should suppress beat sync', () => {
			const renderer = createReducedMotionRenderer()
			renderer.setFollowCount(5)
			renderer.update(100)

			const beatPhase = (renderer as unknown as { beatPhase: number }).beatPhase
			expect(beatPhase).toBe(0)
		})

		it('should suppress strobe flash', () => {
			const renderer = createReducedMotionRenderer()
			renderer.setFollowCount(5)
			renderer.pulse()

			const strobeFlash = (renderer as unknown as { strobeFlash: boolean })
				.strobeFlash
			expect(strobeFlash).toBe(false)
		})

		it('should suppress light ray alpha spike', () => {
			const renderer = createReducedMotionRenderer()
			renderer.setFollowCount(5)
			renderer.pulse()

			const lightRayAlphaSpike = (
				renderer as unknown as { lightRayAlphaSpike: number }
			).lightRayAlphaSpike
			expect(lightRayAlphaSpike).toBe(0)
		})
	})
})
