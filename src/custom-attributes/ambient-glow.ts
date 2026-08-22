import { customAttribute, INode, resolve } from 'aurelia'
import { prefersReducedMotion } from '../util/prefers-reduced-motion'

/**
 * Ambient background glow for the welcome landing page.
 *
 * Renders a sparse field of slowly drifting, soft light motes on the host
 * `<canvas>`, evoking "signals in the air" (concerts out there waiting to be
 * surfaced). Paired with `mix-blend-mode: screen` in CSS so the motes glow
 * additively over the dark surface.
 *
 * Cheap by construction: a small, capped particle count; device-pixel-ratio
 * capped at 2; the loop pauses when the tab is hidden. Under
 * `prefers-reduced-motion` it paints a single static frame and never animates.
 *
 * Usage: `<canvas ambient-glow aria-hidden="true"></canvas>`
 */
@customAttribute('ambient-glow')
export class AmbientGlowCustomAttribute {
	private readonly canvas = resolve(INode) as HTMLCanvasElement

	private ctx: CanvasRenderingContext2D | null = null
	private rafId: number | null = null
	private particles: Particle[] = []
	private width = 0
	private height = 0
	private dpr = 1
	/** Pre-rendered soft-dot sprite; drawn (scaled) per mote instead of building
	 *  a fresh radial gradient every frame. */
	private sprite: HTMLCanvasElement | null = null

	// Arrow functions so add/removeEventListener share the same reference.
	private readonly onResize = (): void => {
		this.resize()
		// A reduced-motion field has no loop, so repaint the single frame here.
		if (prefersReducedMotion()) this.draw()
	}
	private readonly onVisibility = (): void => {
		if (document.hidden) {
			this.stop()
		} else if (!prefersReducedMotion()) {
			this.start()
		}
	}

	public attached(): void {
		const ctx = this.canvas.getContext('2d')
		if (!ctx) return
		this.ctx = ctx
		this.sprite = this.makeSprite()
		this.resize()
		this.seed()

		// Always listen for resize: it re-seeds if the canvas started at 0×0
		// (unlaid-out / bfcache) and repaints the static frame under reduced motion.
		window.addEventListener('resize', this.onResize)

		if (prefersReducedMotion()) {
			// Paint one static frame; no animation loop.
			this.draw()
			return
		}

		document.addEventListener('visibilitychange', this.onVisibility)
		this.start()
	}

	public detaching(): void {
		this.stop()
		window.removeEventListener('resize', this.onResize)
		document.removeEventListener('visibilitychange', this.onVisibility)
	}

	private start(): void {
		if (this.rafId !== null) return
		const loop = (): void => {
			this.step()
			this.draw()
			this.rafId = requestAnimationFrame(loop)
		}
		this.rafId = requestAnimationFrame(loop)
	}

	private stop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId)
			this.rafId = null
		}
	}

	private resize(): void {
		this.dpr = Math.min(window.devicePixelRatio || 1, 2)
		const rect = this.canvas.getBoundingClientRect()
		this.width = rect.width
		this.height = rect.height
		this.canvas.width = Math.round(this.width * this.dpr)
		this.canvas.height = Math.round(this.height * this.dpr)
		this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
		// If the canvas was 0×0 when first seeded (not yet laid out / bfcache),
		// seed now that real dimensions exist — the field would otherwise stay empty.
		if (this.particles.length === 0 && this.width > 0 && this.height > 0) {
			this.seed()
		}
	}

	/**
	 * Render the soft radial dot once into an offscreen canvas so the frame loop
	 * can `drawImage` it (scaled per mote) instead of rebuilding a gradient and
	 * parsing an oklch string for every particle on every frame.
	 */
	private makeSprite(): HTMLCanvasElement {
		const size = 128
		const c = document.createElement('canvas')
		c.width = size
		c.height = size
		const sctx = c.getContext('2d')
		if (sctx) {
			const r = size / 2
			const g = sctx.createRadialGradient(r, r, 0, r, r, r)
			g.addColorStop(0, 'oklch(72% 0.16 200deg / 1)')
			g.addColorStop(1, 'oklch(70% 0.16 200deg / 0)')
			sctx.fillStyle = g
			sctx.fillRect(0, 0, size, size)
		}
		return c
	}

	private seed(): void {
		// Scale count to area but cap hard for mobile INP/battery.
		const target = Math.min(44, Math.round((this.width * this.height) / 26000))
		this.particles = Array.from({ length: target }, (_, i) =>
			this.makeParticle(i, true),
		)
	}

	/**
	 * Deterministic pseudo-random from an index + salt — avoids `Math.random`
	 * (blocked in this environment) while giving a varied, stable field.
	 */
	private rand(seed: number): number {
		const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
		return x - Math.floor(x)
	}

	private makeParticle(i: number, initial: boolean): Particle {
		const r = (s: number): number => this.rand(i * 7.1 + s)
		return {
			x: r(1) * this.width,
			y: initial ? r(2) * this.height : this.height + 20,
			radius: 24 + r(3) * 56,
			// Drift slowly upward with a gentle horizontal sway.
			vy: -(0.08 + r(4) * 0.16),
			sway: 0.3 + r(5) * 0.6,
			phase: r(6) * Math.PI * 2,
			alpha: 0.05 + r(7) * 0.12,
		}
	}

	private step(): void {
		for (let i = 0; i < this.particles.length; i++) {
			const p = this.particles[i]
			p.y += p.vy
			p.phase += 0.005
			p.x += Math.sin(p.phase) * p.sway * 0.2
			// Recycle a mote once it drifts off the top.
			if (p.y + p.radius < 0) {
				this.particles[i] = this.makeParticle(i, false)
			}
		}
	}

	private draw(): void {
		const ctx = this.ctx
		const sprite = this.sprite
		if (!ctx || !sprite) return
		ctx.clearRect(0, 0, this.width, this.height)
		for (const p of this.particles) {
			// Draw the cached soft-dot sprite scaled to the mote's radius; per-mote
			// intensity is just globalAlpha — no per-frame gradient/color allocation.
			ctx.globalAlpha = p.alpha
			ctx.drawImage(
				sprite,
				p.x - p.radius,
				p.y - p.radius,
				p.radius * 2,
				p.radius * 2,
			)
		}
		ctx.globalAlpha = 1
	}
}

interface Particle {
	x: number
	y: number
	radius: number
	vy: number
	sway: number
	phase: number
	alpha: number
}
