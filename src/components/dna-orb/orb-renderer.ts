import { getStageParams, type StageParams } from './stage-effects'

interface TrailPoint {
	x: number
	y: number
}

interface OrbParticle {
	angle: number
	radius: number
	speed: number
	size: number
	hue: number
	opacity: number
	trail: TrailPoint[]
}

interface OrbitalParticle {
	angle: number
	orbitalRadius: number
	speed: number
	size: number
	hue: number
	halfWidth: number
	counterRotate: boolean
}

interface ShockwaveRing {
	active: boolean
	progress: number
	hue: number
}

interface LightRay {
	halfWidth: number
	counterRotate: boolean
}

const MAX_INNER_PARTICLES = 60
const MAX_ORBITALS = 12
const MAX_SHOCKWAVES = 5
const MAX_PALETTE = 20
const MAX_LIGHT_RAYS = 16

export class OrbRenderer {
	private particles: OrbParticle[] = []
	private orbitals: OrbitalParticle[] = []
	private shockwaves: ShockwaveRing[] = []
	private lightRays: LightRay[] = []
	public colorPalette: number[] = []
	private time = 0
	private particleScale = 1.0
	private pulseIntensity = 0
	public swirlIntensity = 0
	public baseIntensity = 0
	private stageParams: StageParams = getStageParams(0)
	private canvasWidth = 0
	private canvasHeight = 0
	private beatPhase = 0
	private strobeFlash = false
	private lightRayAlphaSpike = 0
	private pendingStaggeredShockwaves = 0
	private staggerAccumulator = 0
	private staggerHue = 0

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
		this.initLightRays()
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
				trail: [],
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
				halfWidth: 0.15,
				counterRotate: i % 3 === 0,
			})
		}
	}

	private initShockwaves(): void {
		this.shockwaves = []
		for (let i = 0; i < MAX_SHOCKWAVES; i++) {
			this.shockwaves.push({ active: false, progress: 0, hue: 260 })
		}
	}

	private initLightRays(): void {
		this.lightRays = []
		for (let i = 0; i < MAX_LIGHT_RAYS; i++) {
			this.lightRays.push({
				halfWidth: 0.08 + Math.random() * 0.17,
				counterRotate: i % 3 === 0,
			})
		}
	}

	public pulse(): void {
		this.pulseIntensity = 1.0
		this.lightRayAlphaSpike = this.reducedMotion ? 0 : 0.8

		if (this.stageParams.strobeEnabled && !this.reducedMotion) {
			this.strobeFlash = true
			this.pendingStaggeredShockwaves = 2
			this.staggerAccumulator = 0
			this.staggerHue =
				this.colorPalette.length > 0
					? this.colorPalette[this.colorPalette.length - 1]
					: 260
		}
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

		if (this.lightRayAlphaSpike > 0) {
			this.lightRayAlphaSpike = Math.max(
				0,
				this.lightRayAlphaSpike - delta / 200,
			)
		}

		// Beat sync
		const sp = this.stageParams
		if (sp.beatBPM > 0 && !this.reducedMotion) {
			this.beatPhase = Math.sin(this.time * sp.beatBPM * 2 * Math.PI)
		} else {
			this.beatPhase = 0
		}

		// Staggered shockwaves from strobe
		if (this.pendingStaggeredShockwaves > 0) {
			this.staggerAccumulator += delta
			if (this.staggerAccumulator >= 50) {
				this.staggerAccumulator -= 50
				this.spawnShockwave(this.staggerHue)
				this.pendingStaggeredShockwaves--
			}
		}

		const effectiveSwirl = this.baseIntensity + this.swirlIntensity
		const swirlMultiplier = this.reducedMotion ? 1 : 1 + effectiveSwirl * 2

		const trailLen = this.reducedMotion ? 0 : sp.vortexTrailLength
		for (const p of this.particles) {
			p.angle += p.speed * delta * 0.002 * swirlMultiplier
			p.radius += Math.sin(this.time * p.speed) * 0.1
			p.radius = Math.max(0, Math.min(this.orbRadius * 0.8, p.radius))

			// Record trail point
			if (trailLen > 0) {
				const px = this.orbX + Math.cos(p.angle) * p.radius
				const py = this.orbY + Math.sin(p.angle) * p.radius
				p.trail.push({ x: px, y: py })
				if (p.trail.length > trailLen) {
					p.trail.shift()
				}
			}
		}

		if (!this.reducedMotion) {
			const orbitalSpeed = sp.orbitalSpeedMultiplier
			for (const o of this.orbitals) {
				const dir = o.counterRotate ? -1 : 1
				o.angle += o.speed * delta * 0.001 * orbitalSpeed * dir
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

		// Nebula fill layers (inside orb, before particles)
		this.renderNebula(ctx, renderRadius)

		// Inner swirling particles (with vortex trails)
		const visibleParticles = Math.floor(
			MAX_INNER_PARTICLES * this.particleScale * sp.particleVisibilityRatio,
		)
		const trailLen = this.reducedMotion ? 0 : sp.vortexTrailLength
		for (let i = 0; i < visibleParticles; i++) {
			const p = this.particles[i]
			const pRadius = Math.min(p.radius, renderRadius * 0.8)
			const px = this.orbX + Math.cos(p.angle) * pRadius
			const py = this.orbY + Math.sin(p.angle) * pRadius
			const pOpacity = p.opacity * (0.3 + combinedIntensity * 0.7)
			const pSize = p.size * (0.5 + combinedIntensity * 0.5)

			if (trailLen > 0 && p.trail.length > 1) {
				// Tapered vortex trail
				ctx.save()
				ctx.lineCap = 'round'
				for (let t = 1; t < p.trail.length; t++) {
					const progress = t / p.trail.length
					const lineWidth = pSize * 1.5 * progress + 0.5 * (1 - progress)
					const alpha = pOpacity * progress + 0.05 * (1 - progress)
					ctx.strokeStyle = `hsla(${p.hue}, 80%, 70%, ${alpha})`
					ctx.lineWidth = lineWidth
					ctx.beginPath()
					ctx.moveTo(p.trail[t - 1].x, p.trail[t - 1].y)
					ctx.lineTo(p.trail[t].x, p.trail[t].y)
					ctx.stroke()
				}
				// Draw head-to-current connection
				if (p.trail.length > 0) {
					const last = p.trail[p.trail.length - 1]
					ctx.strokeStyle = `hsla(${p.hue}, 80%, 70%, ${pOpacity})`
					ctx.lineWidth = pSize * 1.5
					ctx.beginPath()
					ctx.moveTo(last.x, last.y)
					ctx.lineTo(px, py)
					ctx.stroke()
				}
				ctx.restore()
			}

			// Particle head dot
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

	public renderNebula(
		ctx: CanvasRenderingContext2D,
		renderRadius: number,
	): void {
		const sp = this.stageParams
		if (sp.nebulaLayerCount === 0) return

		ctx.save()
		ctx.globalCompositeOperation = 'screen'

		// Clip to orb boundary
		ctx.beginPath()
		ctx.arc(this.orbX, this.orbY, renderRadius * 0.95, 0, Math.PI * 2)
		ctx.clip()

		const speeds = [0.15, -0.1, 0.08]
		for (let i = 0; i < sp.nebulaLayerCount; i++) {
			const hue =
				this.colorPalette.length > 0
					? this.colorPalette[i % this.colorPalette.length]
					: 260
			const rotation = this.reducedMotion ? 0 : this.time * speeds[i]
			const offsetX = Math.cos(rotation) * renderRadius * 0.3
			const offsetY = Math.sin(rotation) * renderRadius * 0.3

			const grad = ctx.createRadialGradient(
				this.orbX + offsetX,
				this.orbY + offsetY,
				0,
				this.orbX + offsetX,
				this.orbY + offsetY,
				renderRadius * 0.8,
			)
			grad.addColorStop(0, `hsla(${hue}, 80%, 60%, ${sp.nebulaAlpha * 0.8})`)
			grad.addColorStop(
				0.5,
				`hsla(${(hue + 40) % 360}, 70%, 50%, ${sp.nebulaAlpha * 0.4})`,
			)
			grad.addColorStop(1, `hsla(${(hue + 80) % 360}, 60%, 40%, 0)`)
			ctx.fillStyle = grad
			ctx.beginPath()
			ctx.arc(
				this.orbX + offsetX,
				this.orbY + offsetY,
				renderRadius * 0.8,
				0,
				Math.PI * 2,
			)
			ctx.fill()
		}

		ctx.restore()
	}

	public renderOrbitals(ctx: CanvasRenderingContext2D): void {
		const sp = this.stageParams
		const count = sp.orbitalCount
		if (count === 0) return

		ctx.save()
		const breathScale = this.reducedMotion
			? 1
			: 1 + Math.sin(this.time * sp.breathSpeed) * sp.breathAmplitude
		const renderRadius = sp.orbRadius * breathScale
		const beatSizeFactor = 1 + this.beatPhase * 0.1
		const tailArcRad = (sp.orbitalTailArc * Math.PI) / 180

		for (let i = 0; i < count; i++) {
			const o = this.orbitals[i]
			const dist = renderRadius * o.orbitalRadius
			const effectiveSize = sp.orbitalSize * beatSizeFactor
			const ox = this.orbX + Math.cos(o.angle) * dist
			const oy = this.orbY + Math.sin(o.angle) * dist

			// Comet tail arc
			if (tailArcRad > 0 && !this.reducedMotion) {
				const tailStart = o.counterRotate ? o.angle : o.angle - tailArcRad
				const tailEnd = o.counterRotate ? o.angle + tailArcRad : o.angle
				ctx.save()
				ctx.strokeStyle = `hsla(${o.hue}, 80%, 70%, 0.3)`
				ctx.lineWidth = effectiveSize * 0.8
				ctx.lineCap = 'round'
				ctx.globalAlpha = 0.5
				ctx.beginPath()
				ctx.arc(this.orbX, this.orbY, dist, tailStart, tailEnd)
				ctx.stroke()

				// Gradient overlay on tail
				const midAngle = (tailStart + tailEnd) / 2
				const midX = this.orbX + Math.cos(midAngle) * dist
				const midY = this.orbY + Math.sin(midAngle) * dist
				const tailGrad = ctx.createRadialGradient(
					ox,
					oy,
					0,
					midX,
					midY,
					dist * tailArcRad,
				)
				tailGrad.addColorStop(0, `hsla(${o.hue}, 80%, 70%, 0.4)`)
				tailGrad.addColorStop(1, `hsla(${o.hue}, 80%, 70%, 0)`)
				ctx.strokeStyle = tailGrad
				ctx.beginPath()
				ctx.arc(this.orbX, this.orbY, dist, tailStart, tailEnd)
				ctx.stroke()
				ctx.restore()
			}

			// Orbital glow dot
			const glowRadius = effectiveSize * 4
			const glowGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, glowRadius)
			glowGrad.addColorStop(0, `hsla(${o.hue}, 80%, 70%, 0.8)`)
			glowGrad.addColorStop(0.3, `hsla(${o.hue}, 80%, 60%, 0.4)`)
			glowGrad.addColorStop(1, `hsla(${o.hue}, 80%, 60%, 0)`)
			ctx.fillStyle = glowGrad
			ctx.beginPath()
			ctx.arc(ox, oy, glowRadius, 0, Math.PI * 2)
			ctx.fill()
		}
		ctx.restore()
	}

	public renderLightRays(ctx: CanvasRenderingContext2D): void {
		const sp = this.stageParams
		const count = sp.lightRayCount
		if (count === 0) return

		ctx.save()
		ctx.globalCompositeOperation = 'screen'

		const rayLength = sp.orbRadius * 2.5
		const baseAlpha = Math.max(sp.lightRayAlpha, this.lightRayAlphaSpike)
		const beatAlpha = baseAlpha * (1 + this.beatPhase * 0.1)
		const rotationOffset = this.reducedMotion
			? 0
			: this.time * sp.lightRayRotationSpeed

		for (let i = 0; i < count; i++) {
			const ray = this.lightRays[i]
			const dir = ray.counterRotate ? -1 : 1
			const baseAngle = (i / count) * Math.PI * 2 + rotationOffset * dir
			const hue =
				this.colorPalette.length > 0
					? this.colorPalette[i % this.colorPalette.length]
					: 260

			// Per-ray width from lightRayWidthMin/Max
			const halfWidth =
				sp.lightRayWidthMin +
				ray.halfWidth * (sp.lightRayWidthMax - sp.lightRayWidthMin)

			// Gradient from root to tip
			const tipX = this.orbX + Math.cos(baseAngle) * rayLength
			const tipY = this.orbY + Math.sin(baseAngle) * rayLength
			const grad = ctx.createLinearGradient(this.orbX, this.orbY, tipX, tipY)
			grad.addColorStop(0, `hsla(${hue}, 90%, 80%, ${beatAlpha * 1.2})`)
			grad.addColorStop(
				0.3,
				`hsla(${(hue + 30) % 360}, 80%, 70%, ${beatAlpha})`,
			)
			grad.addColorStop(1, `hsla(${(hue + 60) % 360}, 70%, 60%, 0)`)

			ctx.fillStyle = grad
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

	public renderStrobeFlash(ctx: CanvasRenderingContext2D): void {
		if (!this.strobeFlash) return
		ctx.save()
		ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
		ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight)
		ctx.restore()
		this.strobeFlash = false
	}

	public setFollowCount(count: number): void {
		this.baseIntensity = count > 0 ? 1 - 1 / (1 + count * 0.5) : 0
		this.stageParams = getStageParams(count)
		for (const p of this.particles) {
			p.trail = []
		}
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
