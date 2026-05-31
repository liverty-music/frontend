import { easeOutQuad } from './easing'

interface RuptureRing {
	x: number
	y: number
	hue: number
	progress: number
	maxRadius: number
}

interface Flash {
	x: number
	y: number
	hue: number
	progress: number
	radius: number
}

interface Inflation {
	x: number
	y: number
	radius: number
	hue: number
	progress: number
	onBurst: () => void
}

/** Rupture ring lifetime (ms) — a quick, bright flash. */
const RUPTURE_MS = 220
/** Light-burst flash lifetime (ms) — a fast additive bloom of light. */
const FLASH_MS = 160
/** Over-inflation anticipation lifetime (ms) before the bubble ruptures. */
const INFLATE_MS = 40
/** Peak extra scale the bubble swells to at the moment of rupture. */
const INFLATE_PEAK = 0.15

/**
 * Lightweight canvas overlay for the moment-of-tap feedback: a brief
 * over-inflation of the tapped bubble (membrane tension) that ruptures into a
 * bright expanding ring, after which `onBurst` fires to start absorption.
 *
 * When `reducedMotion` is set, the inflation and ring are suppressed and the
 * burst fires immediately so absorption begins without the pre-roll, honoring
 * `prefers-reduced-motion`.
 */
export class TapEffects {
	private rings: RuptureRing[] = []
	private flashes: Flash[] = []
	private inflations: Inflation[] = []

	constructor(public reducedMotion = false) {}

	public get isActive(): boolean {
		return (
			this.rings.length > 0 ||
			this.flashes.length > 0 ||
			this.inflations.length > 0
		)
	}

	/**
	 * Flash a bright rupture ring plus an additive light bloom outward from the
	 * burst point — the "pop of light" that makes the burst feel energetic.
	 */
	public addRupture(x: number, y: number, radius: number, hue = 0): void {
		if (this.reducedMotion) return
		this.rings.push({ x, y, hue, progress: 0, maxRadius: radius * 2.2 })
		this.flashes.push({ x, y, hue, progress: 0, radius: radius * 2.6 })
	}

	/**
	 * Register an over-inflation anticipation at the bubble's position. The
	 * bubble swells, then ruptures: at the peak, `onBurst` fires (used to spawn
	 * the droplet spray and start absorption). With reduced motion, `onBurst` is
	 * invoked synchronously and nothing renders.
	 */
	public addPress(
		x: number,
		y: number,
		radius: number,
		hue: number,
		onBurst: () => void,
	): void {
		if (this.reducedMotion) {
			onBurst()
			return
		}
		this.inflations.push({ x, y, radius, hue, progress: 0, onBurst })
	}

	public update(delta: number): void {
		for (let i = this.rings.length - 1; i >= 0; i--) {
			const r = this.rings[i]
			r.progress = Math.min(1, r.progress + delta / RUPTURE_MS)
			if (r.progress >= 1) this.rings.splice(i, 1)
		}

		for (let i = this.flashes.length - 1; i >= 0; i--) {
			const f = this.flashes[i]
			f.progress = Math.min(1, f.progress + delta / FLASH_MS)
			if (f.progress >= 1) this.flashes.splice(i, 1)
		}

		for (let i = this.inflations.length - 1; i >= 0; i--) {
			const p = this.inflations[i]
			p.progress = Math.min(1, p.progress + delta / INFLATE_MS)
			if (p.progress >= 1) {
				this.inflations.splice(i, 1)
				p.onBurst()
			}
		}
	}

	public render(ctx: CanvasRenderingContext2D): void {
		// Additive light bloom — a fast bright flash that reads as a burst of light.
		for (const f of this.flashes) {
			const radius = f.radius * easeOutQuad(f.progress)
			const alpha = 0.85 * (1 - f.progress) ** 2
			ctx.save()
			ctx.globalCompositeOperation = 'lighter'
			const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius)
			grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
			grad.addColorStop(0.35, `hsla(${f.hue}, 100%, 75%, ${alpha * 0.6})`)
			grad.addColorStop(1, `hsla(${f.hue}, 100%, 60%, 0)`)
			ctx.fillStyle = grad
			ctx.beginPath()
			ctx.arc(f.x, f.y, radius, 0, Math.PI * 2)
			ctx.fill()
			ctx.restore()
		}

		// Bright, slightly colored rupture ring snapping outward.
		for (const r of this.rings) {
			const radius = r.maxRadius * easeOutQuad(r.progress)
			const alpha = 0.8 * (1 - r.progress)
			ctx.save()
			ctx.globalCompositeOperation = 'lighter'
			ctx.strokeStyle = `hsla(${r.hue}, 100%, 85%, ${alpha})`
			ctx.lineWidth = 3.5 * (1 - r.progress) + 1
			ctx.beginPath()
			ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
			ctx.stroke()
			ctx.restore()
		}

		for (const p of this.inflations) {
			// Swell uniformly toward the rupture peak, fading out as it pops.
			const scale = 1 + INFLATE_PEAK * p.progress
			const radius = p.radius * scale
			const alpha = 0.95 * (1 - p.progress * 0.5)
			ctx.save()
			const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
			grad.addColorStop(0, `hsla(${p.hue}, 60%, 78%, ${alpha})`)
			grad.addColorStop(
				1,
				`hsla(${(p.hue + 20) % 360}, 45%, 45%, ${alpha * 0.7})`,
			)
			ctx.fillStyle = grad
			ctx.beginPath()
			ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
			ctx.fill()
			ctx.restore()
		}
	}
}
