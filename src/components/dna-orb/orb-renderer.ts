import { getStageParams, type StageParams } from './stage-effects'

interface OrbParticle {
	angle: number
	radius: number
	speed: number
	size: number
	hue: number
	opacity: number
}

interface OrbitalParticle {
	angle: number
	orbitalRadius: number
	speed: number
	size: number
	hue: number
}

interface ShockwaveRing {
	active: boolean
	progress: number
	hue: number
}

const MAX_INNER_PARTICLES = 60
const MAX_ORBITALS = 12
const MAX_SHOCKWAVES = 3
const MAX_PALETTE = 20

export class OrbRenderer {
	private particles: OrbParticle[] = []
	private orbitals: OrbitalParticle[] = []
	private shockwaves: ShockwaveRing[] = []
	public colorPalette: number[] = []
	private time = 0
	private particleScale = 1.0
	private pulseIntensity = 0
	public swirlIntensity = 0
	public baseIntensity = 0
	private stageParams: StageParams = getStageParams(0)
	private canvasWidth = 0
	private canvasHeight = 0

	private readonly reducedMotion =
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches

	public orbX = 0
	public orbY = 0
	public orbRadius = 60

	public init(canvasWidth: number, canvasHeight: number): void {
		this.canvasWidth = canvasWidth
		this.canvasHeight = canvasHeight
		this.orbX = canvasWidth / 2
		this.orbY = canvasHeight - 80
		this.initParticles()
		this.initOrbitals()
		this.initShockwaves()
	}

	private initParticles(): void {
		this.particles = []
		for (let i = 0; i < MAX_INNER_PARTICLES; i++) {
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

	private initOrbitals(): void {
		this.orbitals = []
		for (let i = 0; i < MAX_ORBITALS; i++) {
			this.orbitals.push({
				angle: (i / MAX_ORBITALS) * Math.PI * 2,
				orbitalRadius: 1.3 + Math.random() * 0.5,
				speed: 0.5 + Math.random() * 0.5,
				size: 2 + Math.random() * 3,
				hue: 220 + Math.random() * 60,
			})
		}
	}

	private initShockwaves(): void {
		this.shockwaves = []
		for (let i = 0; i < MAX_SHOCKWAVES; i++) {
			this.shockwaves.push({ active: false, progress: 0, hue: 260 })
		}
	}

	public pulse(): void {
		this.pulseIntensity = 1.0
	}

	public injectColor(hue: number): void {
		const count = 10 + Math.floor(Math.random() * 6)
		const indices: number[] = []
		while (indices.length < count && indices.length < this.particles.length) {
			const idx = Math.floor(Math.random() * this.particles.length)
			if (!indices.includes(idx)) indices.push(idx)
		}
		for (const idx of indices) {
			this.particles[idx].hue = hue + (Math.random() - 0.5) * 20
		}
		this.swirlIntensity = 1.0

		if (this.colorPalette.length >= MAX_PALETTE) {
			this.colorPalette.shift()
		}
		this.colorPalette.push(hue)

		this.distributeColorsToOrbitals()
	}

	public spawnShockwave(hue: number): void {
		if (this.reducedMotion) return
		for (const sw of this.shockwaves) {
			if (!sw.active) {
				sw.active = true
				sw.progress = 0
				sw.hue = hue
				return
			}
		}
	}

	public get activeShockwaveCount(): number {
		return this.shockwaves.filter((sw) => sw.active).length
	}

	public get orbitalCount(): number {
		return this.stageParams.orbitalCount
	}

	private distributeColorsToOrbitals(): void {
		if (this.colorPalette.length === 0) return
		for (let i = 0; i < this.orbitals.length; i++) {
			this.orbitals[i].hue = this.colorPalette[i % this.colorPalette.length]
		}
	}

	public update(delta: number): void {
		this.time += delta * 0.001

		if (this.pulseIntensity > 0) {
			this.pulseIntensity = Math.max(0, this.pulseIntensity - delta / 300)
		}

		if (this.swirlIntensity > 0) {
			this.swirlIntensity = Math.max(0, this.swirlIntensity - delta / 1000)
		}

		const effectiveSwirl = this.baseIntensity + this.swirlIntensity
		const swirlMultiplier = this.reducedMotion ? 1 : 1 + effectiveSwirl * 2

		for (const p of this.particles) {
			p.angle += p.speed * delta * 0.002 * swirlMultiplier
			p.radius += Math.sin(this.time * p.speed) * 0.1
			p.radius = Math.max(0, Math.min(this.orbRadius * 0.8, p.radius))
		}

		if (!this.reducedMotion) {
			const orbitalSpeed = this.stageParams.orbitalSpeedMultiplier
			for (const o of this.orbitals) {
				o.angle += o.speed * delta * 0.001 * orbitalSpeed
			}
		}

		for (const sw of this.shockwaves) {
			if (!sw.active) continue
			sw.progress = Math.min(1, sw.progress + delta / 800)
			if (sw.progress >= 1) {
				sw.active = false
			}
		}
	}

	public render(ctx: CanvasRenderingContext2D): void {
		const sp = this.stageParams
		const breathScale = this.reducedMotion
			? 1
			: 1 + Math.sin(this.time * sp.breathSpeed) * sp.breathAmplitude
		const renderRadius = sp.orbRadius * breathScale

		ctx.save()

		const combinedIntensity = Math.min(
			1,
			this.baseIntensity +
				this.pulseIntensity * 0.4 +
				this.swirlIntensity * 0.4,
		)

		// Outer glow
		const glowSize = renderRadius * (1.2 + combinedIntensity * 0.4)
		const glowGrad = ctx.createRadialGradient(
			this.orbX,
			this.orbY,
			renderRadius * 0.5,
			this.orbX,
			this.orbY,
			glowSize,
		)
		glowGrad.addColorStop(0, `hsla(260, 80%, 60%, ${sp.glowAlpha})`)
		glowGrad.addColorStop(0.5, `hsla(240, 70%, 50%, ${sp.glowAlpha * 0.5})`)
		glowGrad.addColorStop(1, 'hsla(240, 70%, 50%, 0)')
		ctx.fillStyle = glowGrad
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, glowSize, 0, Math.PI * 2)
		ctx.fill()

		// Glass sphere body
		const orbGrad = ctx.createRadialGradient(
			this.orbX - renderRadius * 0.3,
			this.orbY - renderRadius * 0.3,
			renderRadius * 0.1,
			this.orbX,
			this.orbY,
			renderRadius,
		)
		const baseAlpha = 0.15 + combinedIntensity * 0.25
		const saturation = 40 + combinedIntensity * 40
		orbGrad.addColorStop(
			0,
			`hsla(260, ${saturation}%, 80%, ${baseAlpha + 0.2})`,
		)
		orbGrad.addColorStop(0.6, `hsla(250, ${saturation}%, 50%, ${baseAlpha})`)
		orbGrad.addColorStop(
			1,
			`hsla(240, ${saturation}%, 30%, ${baseAlpha - 0.05})`,
		)
		ctx.fillStyle = orbGrad
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, renderRadius, 0, Math.PI * 2)
		ctx.fill()

		// Inner swirling particles
		const visibleParticles = Math.floor(
			MAX_INNER_PARTICLES * this.particleScale * sp.particleVisibilityRatio,
		)
		for (let i = 0; i < visibleParticles; i++) {
			const p = this.particles[i]
			const pRadius = Math.min(p.radius, renderRadius * 0.8)
			const px = this.orbX + Math.cos(p.angle) * pRadius
			const py = this.orbY + Math.sin(p.angle) * pRadius
			const pOpacity = p.opacity * (0.3 + combinedIntensity * 0.7)
			const pSize = p.size * (0.5 + combinedIntensity * 0.5)

			ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${pOpacity})`
			ctx.beginPath()
			ctx.arc(px, py, pSize, 0, Math.PI * 2)
			ctx.fill()
		}

		// Specular highlight
		const specGrad = ctx.createRadialGradient(
			this.orbX - renderRadius * 0.25,
			this.orbY - renderRadius * 0.25,
			0,
			this.orbX - renderRadius * 0.25,
			this.orbY - renderRadius * 0.25,
			renderRadius * 0.5,
		)
		specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)')
		specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
		ctx.fillStyle = specGrad
		ctx.beginPath()
		ctx.arc(
			this.orbX - renderRadius * 0.25,
			this.orbY - renderRadius * 0.25,
			renderRadius * 0.5,
			0,
			Math.PI * 2,
		)
		ctx.fill()

		// Rim outline
		ctx.strokeStyle = `hsla(260, 60%, 70%, ${0.2 + combinedIntensity * 0.3})`
		ctx.lineWidth = 1.5
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, renderRadius, 0, Math.PI * 2)
		ctx.stroke()

		ctx.restore()
	}

	public renderOrbitals(ctx: CanvasRenderingContext2D): void {
		const count = this.stageParams.orbitalCount
		if (count === 0) return

		ctx.save()
		const breathScale = this.reducedMotion
			? 1
			: 1 +
				Math.sin(this.time * this.stageParams.breathSpeed) *
					this.stageParams.breathAmplitude
		const renderRadius = this.stageParams.orbRadius * breathScale

		for (let i = 0; i < count; i++) {
			const o = this.orbitals[i]
			const dist = renderRadius * o.orbitalRadius
			const ox = this.orbX + Math.cos(o.angle) * dist
			const oy = this.orbY + Math.sin(o.angle) * dist

			const glowGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, o.size * 2)
			glowGrad.addColorStop(0, `hsla(${o.hue}, 80%, 70%, 0.8)`)
			glowGrad.addColorStop(0.5, `hsla(${o.hue}, 80%, 60%, 0.3)`)
			glowGrad.addColorStop(1, `hsla(${o.hue}, 80%, 60%, 0)`)
			ctx.fillStyle = glowGrad
			ctx.beginPath()
			ctx.arc(ox, oy, o.size * 2, 0, Math.PI * 2)
			ctx.fill()
		}
		ctx.restore()
	}

	public renderLightRays(ctx: CanvasRenderingContext2D): void {
		const count = this.stageParams.lightRayCount
		if (count === 0) return

		ctx.save()
		ctx.globalCompositeOperation = 'screen'

		const rayLength = this.stageParams.orbRadius * 2.5
		const alpha = this.stageParams.lightRayAlpha
		const rotationOffset = this.reducedMotion
			? 0
			: this.time * this.stageParams.lightRayRotationSpeed

		for (let i = 0; i < count; i++) {
			const baseAngle = (i / count) * Math.PI * 2 + rotationOffset
			const hue =
				this.colorPalette.length > 0
					? this.colorPalette[i % this.colorPalette.length]
					: 260
			const halfWidth = 0.15

			ctx.fillStyle = `hsla(${hue}, 70%, 70%, ${alpha})`
			ctx.beginPath()
			ctx.moveTo(this.orbX, this.orbY)
			ctx.lineTo(
				this.orbX + Math.cos(baseAngle - halfWidth) * rayLength,
				this.orbY + Math.sin(baseAngle - halfWidth) * rayLength,
			)
			ctx.lineTo(
				this.orbX + Math.cos(baseAngle + halfWidth) * rayLength,
				this.orbY + Math.sin(baseAngle + halfWidth) * rayLength,
			)
			ctx.closePath()
			ctx.fill()
		}

		ctx.restore()
	}

	public renderShockwaves(ctx: CanvasRenderingContext2D): void {
		for (const sw of this.shockwaves) {
			if (!sw.active) continue
			const t = sw.progress
			const radius = this.stageParams.orbRadius * (1 + t * 2)
			const alpha = 0.6 * (1 - t)
			const lineWidth = 3 - t * 2.5

			ctx.save()
			ctx.strokeStyle = `hsla(${sw.hue}, 80%, 70%, ${alpha})`
			ctx.lineWidth = Math.max(0.5, lineWidth)
			ctx.beginPath()
			ctx.arc(this.orbX, this.orbY, radius, 0, Math.PI * 2)
			ctx.stroke()
			ctx.restore()
		}
	}

	public renderGroundGlow(ctx: CanvasRenderingContext2D): void {
		const alpha = this.stageParams.groundGlowAlpha
		if (alpha <= 0) return

		ctx.save()
		ctx.globalCompositeOperation = 'screen'

		const glowHeight = this.canvasHeight * 0.15
		const glowY = this.canvasHeight - glowHeight
		const hue =
			this.colorPalette.length > 0
				? this.colorPalette[this.colorPalette.length - 1]
				: 260

		const grad = ctx.createLinearGradient(
			this.orbX,
			glowY,
			this.orbX,
			this.canvasHeight,
		)
		grad.addColorStop(0, `hsla(${hue}, 70%, 50%, 0)`)
		grad.addColorStop(0.5, `hsla(${hue}, 70%, 50%, ${alpha * 0.5})`)
		grad.addColorStop(1, `hsla(${hue}, 70%, 50%, ${alpha})`)

		ctx.fillStyle = grad
		ctx.fillRect(0, glowY, this.canvasWidth, glowHeight)

		ctx.restore()
	}

	public setFollowCount(count: number): void {
		this.baseIntensity = count > 0 ? 1 - 1 / (1 + count * 0.5) : 0
		this.stageParams = getStageParams(count)
		this.orbRadius = this.stageParams.orbRadius
		this.distributeColorsToOrbitals()
	}

	public getStageParams(): StageParams {
		return this.stageParams
	}

	public setParticleScale(scale: number): void {
		this.particleScale = Math.max(0.3, Math.min(1.0, scale))
	}
}
