interface OrbParticle {
	angle: number
	radius: number
	speed: number
	size: number
	hue: number
	opacity: number
}

export class OrbRenderer {
	private particles: OrbParticle[] = []
	private time = 0
	private readonly maxParticles = 60
	private particleScale = 1.0
	private pulseIntensity = 0

	public orbX = 0
	public orbY = 0
	public orbRadius = 70

	public init(canvasWidth: number, canvasHeight: number): void {
		this.orbX = canvasWidth / 2
		this.orbY = canvasHeight - 80
		this.initParticles()
	}

	private initParticles(): void {
		this.particles = []
		for (let i = 0; i < this.maxParticles; i++) {
			this.particles.push({
				angle: Math.random() * Math.PI * 2,
				radius: Math.random() * this.orbRadius * 0.8,
				speed: 0.3 + Math.random() * 0.7,
				size: 1 + Math.random() * 3,
				hue: 220 + Math.random() * 60,
				opacity: 0.2 + Math.random() * 0.5,
			})
		}
	}

	public pulse(): void {
		this.pulseIntensity = 1.0
	}

	public update(delta: number): void {
		this.time += delta * 0.001

		// Decay pulse over ~300ms
		if (this.pulseIntensity > 0) {
			this.pulseIntensity = Math.max(0, this.pulseIntensity - delta / 300)
		}

		for (const p of this.particles) {
			p.angle += p.speed * delta * 0.002
			p.radius += Math.sin(this.time * p.speed) * 0.1
			p.radius = Math.max(0, Math.min(this.orbRadius * 0.8, p.radius))
		}
	}

	public render(ctx: CanvasRenderingContext2D, intensity: number): void {
		ctx.save()

		// Outer glow (boosted during pulse)
		const effectiveIntensity = Math.min(1, intensity + this.pulseIntensity * 0.4)
		const glowSize = this.orbRadius * (1.2 + effectiveIntensity * 0.4)
		const glowGrad = ctx.createRadialGradient(
			this.orbX, this.orbY, this.orbRadius * 0.5,
			this.orbX, this.orbY, glowSize,
		)
		const glowAlpha = 0.1 + effectiveIntensity * 0.25
		glowGrad.addColorStop(0, `hsla(260, 80%, 60%, ${glowAlpha})`)
		glowGrad.addColorStop(0.5, `hsla(240, 70%, 50%, ${glowAlpha * 0.5})`)
		glowGrad.addColorStop(1, 'hsla(240, 70%, 50%, 0)')
		ctx.fillStyle = glowGrad
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, glowSize, 0, Math.PI * 2)
		ctx.fill()

		// Glass sphere body
		const orbGrad = ctx.createRadialGradient(
			this.orbX - this.orbRadius * 0.3,
			this.orbY - this.orbRadius * 0.3,
			this.orbRadius * 0.1,
			this.orbX,
			this.orbY,
			this.orbRadius,
		)
		const baseAlpha = 0.15 + intensity * 0.25
		const saturation = 40 + intensity * 40
		orbGrad.addColorStop(0, `hsla(260, ${saturation}%, 80%, ${baseAlpha + 0.2})`)
		orbGrad.addColorStop(0.6, `hsla(250, ${saturation}%, 50%, ${baseAlpha})`)
		orbGrad.addColorStop(1, `hsla(240, ${saturation}%, 30%, ${baseAlpha - 0.05})`)

		ctx.fillStyle = orbGrad
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, this.orbRadius, 0, Math.PI * 2)
		ctx.fill()

		// Inner swirling particles (scaled by performance quality)
		const visibleParticles = Math.floor(this.maxParticles * this.particleScale * (0.1 + intensity * 0.9))
		for (let i = 0; i < visibleParticles; i++) {
			const p = this.particles[i]
			const px = this.orbX + Math.cos(p.angle) * p.radius
			const py = this.orbY + Math.sin(p.angle) * p.radius
			const pOpacity = p.opacity * (0.3 + intensity * 0.7)
			const pSize = p.size * (0.5 + intensity * 0.5)

			ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${pOpacity})`
			ctx.beginPath()
			ctx.arc(px, py, pSize, 0, Math.PI * 2)
			ctx.fill()
		}

		// Specular highlight (glass reflection)
		const specGrad = ctx.createRadialGradient(
			this.orbX - this.orbRadius * 0.25,
			this.orbY - this.orbRadius * 0.25,
			0,
			this.orbX - this.orbRadius * 0.25,
			this.orbY - this.orbRadius * 0.25,
			this.orbRadius * 0.5,
		)
		specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)')
		specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
		ctx.fillStyle = specGrad
		ctx.beginPath()
		ctx.arc(
			this.orbX - this.orbRadius * 0.25,
			this.orbY - this.orbRadius * 0.25,
			this.orbRadius * 0.5,
			0,
			Math.PI * 2,
		)
		ctx.fill()

		// Rim outline
		ctx.strokeStyle = `hsla(260, 60%, 70%, ${0.2 + intensity * 0.3})`
		ctx.lineWidth = 1.5
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, this.orbRadius, 0, Math.PI * 2)
		ctx.stroke()

		ctx.restore()
	}

	public setParticleScale(scale: number): void {
		this.particleScale = Math.max(0.3, Math.min(1.0, scale))
	}
}
