import {
	bindable,
	ILogger,
	INode,
	resolve,
	shadowCSS,
	useShadowDOM,
} from 'aurelia'
import {
	type ArtistBubble,
	IArtistDiscoveryService,
} from '../../services/artist-discovery-service'
import { AbsorptionAnimator } from './absorption-animator'
import { BubblePhysics, type PhysicsBubble } from './bubble-physics'
import { OrbRenderer } from './orb-renderer'

@useShadowDOM()
export class DnaOrbCanvas {
	static dependencies = [
		shadowCSS(`
			:host {
				display: block;
				width: 100%;
				height: 100%;
			}

			canvas {
				position: absolute;
				inset: 0;
				width: 100%;
				height: 100%;
				outline: none;
			}
		`),
	]
	@bindable public followedCount = 0
	@bindable public showFollowedIndicator = false

	private readonly element = resolve(INode) as HTMLElement
	private canvas!: HTMLCanvasElement
	private ctx!: CanvasRenderingContext2D
	private animFrameId = 0
	private lastTime = 0
	private paused = false

	private physics = new BubblePhysics()
	private orbRenderer = new OrbRenderer()
	private absorptionAnimator = new AbsorptionAnimator()

	private readonly discoveryService = resolve(IArtistDiscoveryService)
	private readonly logger = resolve(ILogger).scopeTo('DnaOrbCanvas')

	private imageCache = new Map<string, HTMLImageElement>()
	private focusedBubbleIndex = -1

	// Performance monitoring
	private frameTimes: number[] = []
	private qualityScale = 1.0 // 1.0 = full, 0.5 = reduced

	public get bubbleCount(): number {
		return this.physics.bubbleCount
	}

	public followedCountChanged(_newVal: number, _oldVal: number): void {
		this.orbRenderer.pulse()
	}

	public async attached(): Promise<void> {
		const ctx = this.canvas.getContext('2d')
		if (!ctx) {
			this.logger.error('Failed to get 2D context')
			return
		}
		this.ctx = ctx

		await this.resize()
		window.addEventListener('resize', this.onResize)
		this.canvas.addEventListener('click', this.onClick)
		this.canvas.addEventListener('touchstart', this.onTouch, { passive: true })
		this.canvas.addEventListener('keydown', this.onKeyDown)

		this.physics.addBubbles(this.discoveryService.availableBubbles)
		this.preloadImages(this.discoveryService.availableBubbles)

		this.lastTime = performance.now()
		this.animFrameId = requestAnimationFrame(this.loop)
	}

	public detaching(): void {
		cancelAnimationFrame(this.animFrameId)
		window.removeEventListener('resize', this.onResize)
		this.canvas.removeEventListener('click', this.onClick)
		this.canvas.removeEventListener('touchstart', this.onTouch)
		this.canvas.removeEventListener('keydown', this.onKeyDown)
		this.physics.destroy()
		this.imageCache.clear()
	}

	public pause(): void {
		if (this.paused) return
		this.paused = true
		cancelAnimationFrame(this.animFrameId)
		this.logger.info('Physics paused')
	}

	public resume(): void {
		if (!this.paused) return
		this.paused = false
		this.lastTime = performance.now()
		this.animFrameId = requestAnimationFrame(this.loop)
		this.logger.info('Physics resumed')
	}

	public reloadBubbles(artists: ArtistBubble[]): void {
		this.physics.reset()
		const rect = this.element.getBoundingClientRect()
		void this.physics.init(rect.width, rect.height).then(() => {
			this.physics.addBubbles(artists)
			this.preloadImages(artists)
			this.focusedBubbleIndex = -1
		})
	}

	private async resize(): Promise<void> {
		const dpr = window.devicePixelRatio || 1
		const rect = this.element.getBoundingClientRect()
		if (!rect || rect.width === 0 || rect.height === 0) return

		this.canvas.width = rect.width * dpr
		this.canvas.height = rect.height * dpr
		this.canvas.style.width = `${rect.width}px`
		this.canvas.style.height = `${rect.height}px`
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

		await this.physics.init(rect.width, rect.height)
		this.orbRenderer.init(rect.width, rect.height)
	}

	private resizeTimeout = 0
	private readonly onResize = (): void => {
		window.clearTimeout(this.resizeTimeout)
		this.resizeTimeout = window.setTimeout(() => {
			void this.resize()
		}, 150)
	}

	private readonly onClick = (e: MouseEvent): void => {
		const rect = this.canvas.getBoundingClientRect()
		this.handleInteraction(e.clientX - rect.left, e.clientY - rect.top)
	}

	private readonly onTouch = (e: TouchEvent): void => {
		const touch = e.touches[0]
		if (!touch) return
		const rect = this.canvas.getBoundingClientRect()
		this.handleInteraction(touch.clientX - rect.left, touch.clientY - rect.top)
	}

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		const bubbles = this.physics.getBubbles()
		if (bubbles.length === 0) return

		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown': {
				e.preventDefault()
				this.focusedBubbleIndex = (this.focusedBubbleIndex + 1) % bubbles.length
				break
			}
			case 'ArrowLeft':
			case 'ArrowUp': {
				e.preventDefault()
				this.focusedBubbleIndex =
					this.focusedBubbleIndex <= 0
						? bubbles.length - 1
						: this.focusedBubbleIndex - 1
				break
			}
			case 'Enter':
			case ' ': {
				e.preventDefault()
				if (
					this.focusedBubbleIndex >= 0 &&
					this.focusedBubbleIndex < bubbles.length
				) {
					const bubble = bubbles[this.focusedBubbleIndex]
					const pos = bubble.body.position
					this.handleInteraction(pos.x, pos.y)
					this.focusedBubbleIndex = Math.min(
						this.focusedBubbleIndex,
						this.physics.getBubbles().length - 1,
					)
				}
				break
			}
		}
	}

	private async handleInteraction(x: number, y: number): Promise<void> {
		const bubble = this.physics.getBubbleAt(x, y)
		if (!bubble) return

		const pos = bubble.body.position
		const artist = bubble.artist

		// Remove from physics and start absorption
		this.physics.removeBubble(artist.id)
		this.absorptionAnimator.startAbsorption(
			artist.id,
			artist.name,
			pos.x,
			pos.y,
			this.orbRenderer.orbX,
			this.orbRenderer.orbY,
			artist.radius,
			artist.imageUrl,
		)

		// Notify parent via DOM event
		this.element.dispatchEvent(
			new CustomEvent('artist-selected', {
				bubbles: true,
				detail: { artist },
			}),
		)

		// Spawn similar artists
		try {
			const similar = await this.discoveryService.getSimilarArtists(
				artist.name,
				artist.id,
			)
			if (similar.length > 0) {
				this.physics.spawnBubblesAt(similar, pos.x, pos.y)
				this.preloadImages(similar)
			} else {
				// No similar artists found - notify parent for user feedback
				this.element.dispatchEvent(
					new CustomEvent('similar-artists-unavailable', {
						bubbles: true,
						detail: { artistName: artist.name },
					}),
				)
			}
		} catch (err) {
			this.logger.warn('Failed to load similar artists', err)
			// Notify parent about error for user feedback
			this.element.dispatchEvent(
				new CustomEvent('similar-artists-error', {
					bubbles: true,
					detail: { artistName: artist.name, error: err },
				}),
			)
		}
	}

	private readonly loop = (time: number): void => {
		const delta = Math.min(time - this.lastTime, 32) // Cap at ~30fps min
		this.lastTime = time

		this.monitorPerformance(delta)

		this.physics.update(delta)
		this.orbRenderer.update(delta)
		this.absorptionAnimator.update(delta)

		this.render()
		this.animFrameId = requestAnimationFrame(this.loop)
	}

	private monitorPerformance(delta: number): void {
		this.frameTimes.push(delta)
		if (this.frameTimes.length < 30) return

		const avgDelta =
			this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
		this.frameTimes = []

		const avgFps = 1000 / avgDelta
		if (avgFps < 40 && this.qualityScale > 0.5) {
			this.qualityScale = 0.5
			this.orbRenderer.setParticleScale(this.qualityScale)
			this.logger.info('Reduced quality for performance', { avgFps })
		} else if (avgFps > 55 && this.qualityScale < 1.0) {
			this.qualityScale = 1.0
			this.orbRenderer.setParticleScale(this.qualityScale)
			this.logger.info('Restored full quality', { avgFps })
		}
	}

	private render(): void {
		const rect = this.element.getBoundingClientRect()
		if (!rect || rect.width === 0 || rect.height === 0) return

		const w = rect.width
		const h = rect.height

		this.ctx.clearRect(0, 0, w, h)

		// Render bubbles
		const bubbles = this.physics.getBubbles()
		for (let i = 0; i < bubbles.length; i++) {
			this.renderBubble(bubbles[i], i === this.focusedBubbleIndex)
		}

		// Render absorption animations
		this.absorptionAnimator.render(this.ctx)

		// Render orb
		this.orbRenderer.render(this.ctx, this.discoveryService.orbIntensity)
	}

	private artistHue(name: string): number {
		let hash = 0
		for (const ch of name) {
			hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
		}
		return ((hash % 360) + 360) % 360
	}

	private renderBubble(bubble: PhysicsBubble, focused: boolean): void {
		const { body, artist, scale, opacity } = bubble
		const x = body.position.x
		const y = body.position.y
		const r = artist.radius * scale
		const isFollowed =
			this.showFollowedIndicator && this.discoveryService.isFollowed(artist.id)

		if (r < 1 || opacity < 0.01) return

		this.ctx.save()
		this.ctx.globalAlpha = isFollowed ? opacity * 0.4 : opacity

		// Focus ring for keyboard navigation
		if (focused) {
			this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
			this.ctx.lineWidth = 3
			this.ctx.setLineDash([4, 4])
			this.ctx.beginPath()
			this.ctx.arc(x, y, r + 4, 0, Math.PI * 2)
			this.ctx.stroke()
			this.ctx.setLineDash([])
		}

		// Per-artist color bubble gradient
		const hue = this.artistHue(artist.name)
		const grad = this.ctx.createRadialGradient(
			x - r * 0.3,
			y - r * 0.3,
			0,
			x,
			y,
			r,
		)
		grad.addColorStop(0, `hsla(${hue}, 60%, 75%, 0.9)`)
		grad.addColorStop(0.7, `hsla(${hue}, 50%, 55%, 0.8)`)
		grad.addColorStop(1, `hsla(${(hue + 20) % 360}, 40%, 40%, 0.6)`)
		this.ctx.fillStyle = grad
		this.ctx.beginPath()
		this.ctx.arc(x, y, r, 0, Math.PI * 2)
		this.ctx.fill()

		// Artist image (if loaded)
		const img = this.imageCache.get(artist.id)
		if (img?.complete && img.naturalWidth > 0) {
			this.ctx.save()
			this.ctx.beginPath()
			this.ctx.arc(x, y, r * 0.7, 0, Math.PI * 2)
			this.ctx.clip()
			this.ctx.drawImage(img, x - r * 0.7, y - r * 0.7, r * 1.4, r * 1.4)
			this.ctx.restore()
		}

		// Artist name
		this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
		this.ctx.font = `bold ${Math.max(9, r * 0.32)}px system-ui, sans-serif`
		this.ctx.textAlign = 'center'
		this.ctx.textBaseline = 'middle'
		const nameY = img?.complete ? y + r * 0.5 : y
		this.ctx.fillText(artist.name, x, nameY, r * 1.8)

		// Subtle outline
		this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
		this.ctx.lineWidth = 1
		this.ctx.beginPath()
		this.ctx.arc(x, y, r, 0, Math.PI * 2)
		this.ctx.stroke()

		// Checkmark for already-followed artists
		if (isFollowed) {
			const checkSize = Math.max(8, r * 0.35)
			this.ctx.globalAlpha = 0.9
			this.ctx.fillStyle = 'rgba(74, 222, 128, 0.9)'
			this.ctx.beginPath()
			this.ctx.arc(x + r * 0.55, y - r * 0.55, checkSize, 0, Math.PI * 2)
			this.ctx.fill()
			this.ctx.strokeStyle = 'white'
			this.ctx.lineWidth = 2
			this.ctx.beginPath()
			this.ctx.moveTo(x + r * 0.55 - checkSize * 0.3, y - r * 0.55)
			this.ctx.lineTo(
				x + r * 0.55 - checkSize * 0.05,
				y - r * 0.55 + checkSize * 0.25,
			)
			this.ctx.lineTo(
				x + r * 0.55 + checkSize * 0.3,
				y - r * 0.55 - checkSize * 0.2,
			)
			this.ctx.stroke()
		}

		this.ctx.restore()
	}

	private preloadImages(bubbles: ArtistBubble[]): void {
		for (const bubble of bubbles) {
			if (!bubble.imageUrl || this.imageCache.has(bubble.id)) continue
			const img = new Image()
			img.crossOrigin = 'anonymous'
			img.src = bubble.imageUrl
			this.imageCache.set(bubble.id, img)
		}
	}
}
