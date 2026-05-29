import { easeOutQuad } from './easing'

interface Ripple {
	x: number
	y: number
	progress: number
	maxRadius: number
}

interface PressGhost {
	x: number
	y: number
	radius: number
	hue: number
	progress: number
	onRelease: () => void
}

/** Ripple lifetime (ms). */
const RIPPLE_MS = 250
/** Press squash-and-stretch lifetime (ms) — the absorption pre-roll. */
const PRESS_MS = 70

/**
 * Lightweight canvas overlay for the moment-of-tap feedback: an expanding
 * ripple at the contact point and a brief squash-and-stretch "press" of the
 * tapped bubble before it is absorbed.
 *
 * When `reducedMotion` is set, ripples are suppressed and the press releases
 * immediately so absorption begins without the pre-roll, honoring
 * `prefers-reduced-motion`.
 */
export class TapEffects {
	private ripples: Ripple[] = []
	private presses: PressGhost[] = []

	constructor(public reducedMotion = false) {}

	public get isActive(): boolean {
		return this.ripples.length > 0 || this.presses.length > 0
	}

	public addRipple(x: number, y: number, radius: number): void {
		if (this.reducedMotion) return
		this.ripples.push({ x, y, progress: 0, maxRadius: radius * 2.4 })
	}

	/**
	 * Register a squash-and-stretch press at the bubble's position. After the
	 * brief pre-roll, `onRelease` fires (used to start the absorption). With
	 * reduced motion, `onRelease` is invoked synchronously and no ghost renders.
	 */
	public addPress(
		x: number,
		y: number,
		radius: number,
		hue: number,
		onRelease: () => void,
	): void {
		if (this.reducedMotion) {
			onRelease()
			return
		}
		this.presses.push({ x, y, radius, hue, progress: 0, onRelease })
	}

	public update(delta: number): void {
		for (let i = this.ripples.length - 1; i >= 0; i--) {
			const r = this.ripples[i]
			r.progress = Math.min(1, r.progress + delta / RIPPLE_MS)
			if (r.progress >= 1) this.ripples.splice(i, 1)
		}

		for (let i = this.presses.length - 1; i >= 0; i--) {
			const p = this.presses[i]
			p.progress = Math.min(1, p.progress + delta / PRESS_MS)
			if (p.progress >= 1) {
				this.presses.splice(i, 1)
				p.onRelease()
			}
		}
	}

	public render(ctx: CanvasRenderingContext2D): void {
		for (const r of this.ripples) {
			const radius = r.maxRadius * easeOutQuad(r.progress)
			const alpha = 0.4 * (1 - r.progress)
			ctx.save()
			ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
			ctx.lineWidth = 2
			ctx.beginPath()
			ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
			ctx.stroke()
			ctx.restore()
		}

		for (const p of this.presses) {
			// Squash horizontally / stretch vertically, easing back toward round.
			const squash = Math.sin(p.progress * Math.PI) * 0.22
			const scaleX = 1 - squash
			const scaleY = 1 + squash
			ctx.save()
			ctx.translate(p.x, p.y)
			ctx.scale(scaleX, scaleY)
			const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.radius)
			grad.addColorStop(0, `hsla(${p.hue}, 60%, 78%, 0.95)`)
			grad.addColorStop(1, `hsla(${(p.hue + 20) % 360}, 45%, 45%, 0.7)`)
			ctx.fillStyle = grad
			ctx.beginPath()
			ctx.arc(0, 0, p.radius, 0, Math.PI * 2)
			ctx.fill()
			ctx.restore()
		}
	}
}
