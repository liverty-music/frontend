interface AbsorptionAnimation {
	artistId: string
	artistName: string
	startX: number
	startY: number
	endX: number
	endY: number
	radius: number
	imageUrl: string
	progress: number
	dissolved: boolean
	hue: number
	onComplete?: (hue: number) => void
}

interface DissolveParticle {
	x: number
	y: number
	vx: number
	vy: number
	size: number
	opacity: number
	hue: number
	life: number
	active: boolean
}

const POOL_SIZE = 60

export class AbsorptionAnimator {
	private animations: AbsorptionAnimation[] = []
	private particlePool: DissolveParticle[] = []

	constructor() {
		// Pre-allocate particle pool to avoid GC pressure
		for (let i = 0; i < POOL_SIZE; i++) {
			this.particlePool.push({
				x: 0,
				y: 0,
				vx: 0,
				vy: 0,
				size: 0,
				opacity: 0,
				hue: 0,
				life: 0,
				active: false,
			})
		}
	}

	public get isAnimating(): boolean {
		return this.animations.length > 0 || this.particlePool.some((p) => p.active)
	}

	public startAbsorption(
		artistId: string,
		artistName: string,
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		radius: number,
		imageUrl: string,
		hue = 260,
		onComplete?: (hue: number) => void,
	): void {
		this.animations.push({
			artistId,
			artistName,
			startX: fromX,
			startY: fromY,
			endX: toX,
			endY: toY,
			radius,
			imageUrl,
			progress: 0,
			dissolved: false,
			hue,
			onComplete,
		})
	}

	public update(delta: number): void {
		for (let i = this.animations.length - 1; i >= 0; i--) {
			const anim = this.animations[i]
			anim.progress = Math.min(1, anim.progress + delta * 0.0015)

			if (anim.progress >= 0.85 && !anim.dissolved) {
				anim.dissolved = true
				this.spawnDissolveParticles(anim.endX, anim.endY)
			}

			if (anim.progress >= 1) {
				anim.onComplete?.(anim.hue)
				this.animations.splice(i, 1)
			}
		}

		for (const p of this.particlePool) {
			if (!p.active) continue
			p.x += p.vx * delta * 0.05
			p.y += p.vy * delta * 0.05
			p.life -= delta * 0.002
			p.opacity = Math.max(0, p.life)
			p.size *= 0.995

			if (p.life <= 0) {
				p.active = false
			}
		}
	}

	public render(ctx: CanvasRenderingContext2D): void {
		for (const anim of this.animations) {
			const t = easeInCubic(anim.progress)

			// Bezier curve path: start -> control point (above midpoint) -> end
			const cpX =
				(anim.startX + anim.endX) / 2 + (anim.startX - anim.endX) * 0.3
			const cpY = Math.min(anim.startY, anim.endY) - 80

			const x = bezierPoint(anim.startX, cpX, anim.endX, t)
			const y = bezierPoint(anim.startY, cpY, anim.endY, t)

			const scale = 1 - t * 0.8
			const radius = anim.radius * scale
			const opacity = 1 - easeInCubic(Math.max(0, (anim.progress - 0.7) / 0.3))

			ctx.save()
			ctx.globalAlpha = opacity

			// Bubble trail
			const trailGrad = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.5)
			trailGrad.addColorStop(0, 'hsla(260, 80%, 70%, 0.3)')
			trailGrad.addColorStop(1, 'hsla(260, 80%, 70%, 0)')
			ctx.fillStyle = trailGrad
			ctx.beginPath()
			ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2)
			ctx.fill()

			// Bubble body
			const grad = ctx.createRadialGradient(
				x - radius * 0.3,
				y - radius * 0.3,
				0,
				x,
				y,
				radius,
			)
			grad.addColorStop(0, 'hsla(260, 70%, 80%, 0.9)')
			grad.addColorStop(1, 'hsla(250, 60%, 50%, 0.7)')
			ctx.fillStyle = grad
			ctx.beginPath()
			ctx.arc(x, y, radius, 0, Math.PI * 2)
			ctx.fill()

			// Artist name
			if (radius > 10) {
				ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
				ctx.font = `${Math.max(8, radius * 0.4)}px sans-serif`
				ctx.textAlign = 'center'
				ctx.textBaseline = 'middle'
				ctx.fillText(anim.artistName, x, y, radius * 1.8)
			}

			ctx.restore()
		}

		// Dissolve particles (from pool)
		for (const p of this.particlePool) {
			if (!p.active) continue
			ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.opacity})`
			ctx.beginPath()
			ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
			ctx.fill()
		}
	}

	private spawnDissolveParticles(x: number, y: number): void {
		let spawned = 0
		for (const p of this.particlePool) {
			if (p.active || spawned >= 15) continue
			const angle = Math.random() * Math.PI * 2
			const speed = 0.5 + Math.random() * 2
			p.x = x
			p.y = y
			p.vx = Math.cos(angle) * speed
			p.vy = Math.sin(angle) * speed
			p.size = 2 + Math.random() * 4
			p.opacity = 1
			p.hue = 220 + Math.random() * 60
			p.life = 1
			p.active = true
			spawned++
		}
	}
}

function easeInCubic(t: number): number {
	return t * t * t
}

function bezierPoint(p0: number, p1: number, p2: number, t: number): number {
	const mt = 1 - t
	return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2
}
