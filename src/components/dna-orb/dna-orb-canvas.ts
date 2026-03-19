import {
	bindable,
	ILogger,
	INode,
	resolve,
	shadowCSS,
	useShadowDOM,
} from 'aurelia'
import type { Artist } from '../../entities/artist'
import { AbsorptionAnimator } from './absorption-animator'
import {
	type BubbleArtistParams,
	BubblePhysics,
	type PhysicsBubble,
} from './bubble-physics'
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
				touch-action: manipulation;
			}
		`),
	]
	@bindable public followedCount = 0
	@bindable public showFollowedIndicator = false
	@bindable public artists: Artist[] = []
	@bindable public followedIds: ReadonlySet<string> = new Set()

	private readonly element = resolve(INode) as HTMLElement
	private canvas!: HTMLCanvasElement
	private ctx!: CanvasRenderingContext2D
	private animFrameId = 0
	private lastTime = 0
	private paused = false

	private physics = new BubblePhysics()
	private orbRenderer = new OrbRenderer()
	private absorptionAnimator = new AbsorptionAnimator()

	private readonly logger = resolve(ILogger).scopeTo('DnaOrbCanvas')

	private focusedBubbleIndex = -1
	private reloadGeneration = 0
	private isProcessing = false

	// Performance monitoring
	private frameTimes: number[] = []
	private qualityScale = 1.0 // 1.0 = full, 0.5 = reduced

	public get bubbleCount(): number {
		return this.physics.bubbleCount
	}

	public get canvasRect(): { width: number; height: number } {
		const rect = this.element.getBoundingClientRect()
		return { width: rect.width, height: rect.height }
	}

	public followedCountChanged(newVal: number, _oldVal: number): void {
		this.orbRenderer.pulse()
		this.orbRenderer.setFollowCount(newVal)
		const sp = this.orbRenderer.getStageParams()
		this.physics.updateOrbZone(sp.orbRadius)
		this.absorptionAnimator.cometTrailEnabled = sp.cometTrailEnabled
	}

	public artistsChanged(newVal: Artist[]): void {
		if (!this.ctx) return // not yet attached
		const params = newVal.map((a) => toBubbleParams(a))
		this.physics.addBubbles(params)
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
		this.canvas.addEventListener('pointerdown', this.onPointerDown)
		this.canvas.addEventListener('keydown', this.onKeyDown)

		const params = this.artists.map((a) => toBubbleParams(a))
		this.physics.addBubbles(params)

		this.lastTime = performance.now()
		this.animFrameId = requestAnimationFrame(this.loop)
	}

	public detaching(): void {
		cancelAnimationFrame(this.animFrameId)
		window.removeEventListener('resize', this.onResize)
		this.canvas.removeEventListener('pointerdown', this.onPointerDown)
		this.canvas.removeEventListener('keydown', this.onKeyDown)
		this.physics.destroy()
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

	public reloadBubbles(artists: Artist[]): void {
		const rect = this.element.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) return

		const gen = ++this.reloadGeneration
		this.physics.reset()
		void this.physics.init(rect.width, rect.height).then(() => {
			if (gen !== this.reloadGeneration) return // stale
			const params = artists.map((a) => toBubbleParams(a))
			this.physics.addBubbles(params)
			this.focusedBubbleIndex = -1
		})
	}

	/**
	 * Spawn new bubbles at a specific position (called by parent after fetching similar artists).
	 */
	public spawnBubblesAt(artists: Artist[], x: number, y: number): void {
		const params = artists.map((a) => toBubbleParams(a))
		this.physics.spawnBubblesAt(params, x, y)
	}

	/**
	 * Spawn a temporary bubble and immediately absorb it into the orb.
	 * Used when following an artist from search results.
	 */
	public spawnAndAbsorb(artist: Artist, x: number, y: number): void {
		const id = artist.id
		const name = artist.name
		const radius = 30 + Math.random() * 15
		const hue = this.artistHue(name)
		this.absorptionAnimator.startAbsorption(
			id,
			name,
			x,
			y,
			this.orbRenderer.orbX,
			this.orbRenderer.orbY,
			radius,
			hue,
			(completedHue) => {
				this.orbRenderer.injectColor(completedHue)
				if (this.orbRenderer.getStageParams().shockwaveEnabled) {
					this.orbRenderer.spawnShockwave(completedHue)
				}
			},
		)

		this.element.dispatchEvent(
			new CustomEvent('need-more-bubbles', {
				bubbles: true,
				detail: {
					artistId: id,
					artistName: name,
					position: { x, y },
				},
			}),
		)
	}

	/**
	 * Fade out specific bubbles by ID (called by parent for eviction).
	 */
	public async fadeOutBubbles(ids: string[]): Promise<void> {
		await this.physics.fadeOutBubbles(ids)
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

	private readonly onPointerDown = (e: PointerEvent): void => {
		const rect = this.canvas.getBoundingClientRect()
		this.handleInteraction(e.clientX - rect.left, e.clientY - rect.top)
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

	private handleInteraction(x: number, y: number): void {
		if (this.isProcessing) return
		this.isProcessing = true
		try {
			const bubble = this.physics.getBubbleAt(x, y)
			if (!bubble) {
				this.isProcessing = false
				return
			}

			const pos = bubble.body.position
			const artist = bubble.artist
			const artistId = artist.id
			const artistName = artist.name

			// Remove from physics and start absorption
			const hue = this.artistHue(artistName)
			this.physics.removeBubble(artistId)
			this.absorptionAnimator.startAbsorption(
				artistId,
				artistName,
				pos.x,
				pos.y,
				this.orbRenderer.orbX,
				this.orbRenderer.orbY,
				bubble.radius,
				hue,
				(completedHue) => {
					this.orbRenderer.injectColor(completedHue)
					if (this.orbRenderer.getStageParams().shockwaveEnabled) {
						this.orbRenderer.spawnShockwave(completedHue)
					}
				},
			)

			// Notify parent via DOM event
			this.element.dispatchEvent(
				new CustomEvent('artist-selected', {
					bubbles: true,
					detail: { artist, position: { x: pos.x, y: pos.y } },
				}),
			)

			// Request parent to fetch similar artists and provide new bubbles
			this.element.dispatchEvent(
				new CustomEvent('need-more-bubbles', {
					bubbles: true,
					detail: {
						artistId,
						artistName,
						position: { x: pos.x, y: pos.y },
					},
				}),
			)
		} finally {
			this.isProcessing = false
		}
	}

	private readonly loop = (time: number): void => {
		const delta = Math.min(time - this.lastTime, 32) // Cap at ~30fps min to prevent physics explosions on tab-switch/GC pauses
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

		// Layer 0: Ground glow (behind everything)
		this.orbRenderer.renderGroundGlow(this.ctx)

		// Layer 1: Light rays (additive blend, behind bubbles)
		this.orbRenderer.renderLightRays(this.ctx)

		// Layer 2: Bubbles
		const bubbles = this.physics.getBubbles()
		for (let i = 0; i < bubbles.length; i++) {
			this.renderBubble(bubbles[i], i === this.focusedBubbleIndex)
		}

		// Layer 3-4: Comet trails + absorption animations
		this.absorptionAnimator.render(this.ctx)

		// Layer 5: Orb body
		this.orbRenderer.render(this.ctx)

		// Layer 6: Orbital particles
		this.orbRenderer.renderOrbitals(this.ctx)

		// Layer 7: Shockwave rings
		this.orbRenderer.renderShockwaves(this.ctx)

		// Layer 8: Strobe flash (single-frame overlay, self-clearing)
		this.orbRenderer.renderStrobeFlash(this.ctx)
	}

	private artistHue(name: string): number {
		let hash = 0
		for (const ch of name) {
			hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
		}
		return ((hash % 360) + 360) % 360
	}

	private renderBubble(bubble: PhysicsBubble, focused: boolean): void {
		const { body, artist, radius, scale, opacity } = bubble
		const x = body.position.x
		const y = body.position.y
		const r = radius * scale
		const artistId = artist.id
		const artistName = artist.name
		const isFollowed =
			this.showFollowedIndicator && this.followedIds.has(artistId)

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
		const hue = this.artistHue(artistName)
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

		// Artist name (adaptive sizing + word wrap)
		this.renderBubbleText(artistName, x, y, r)

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

	private renderBubbleText(
		name: string,
		cx: number,
		cy: number,
		radius: number,
	): void {
		const usableWidth = radius * 1.6
		const minFont = 10
		let fontSize = Math.max(minFont, radius * 0.38)

		this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
		this.ctx.textAlign = 'center'
		this.ctx.textBaseline = 'middle'

		const maxLines = 3

		// Word-wrap and adaptive sizing loop
		let lines: string[]
		for (;;) {
			this.ctx.font = `bold ${fontSize}px system-ui, sans-serif`
			lines = this.wrapTextLocal(name, usableWidth)

			// Shrink font if lines overflow width or exceed max line count
			const allFit = lines.every(
				(line) => this.ctx.measureText(line).width <= usableWidth,
			)
			if ((allFit && lines.length <= maxLines) || fontSize <= minFont) break
			fontSize -= 0.5
		}

		// Truncate to maxLines if still exceeded after font floor
		if (lines.length > maxLines) {
			lines = lines.slice(0, maxLines)
		}

		const lineHeight = fontSize * 1.25
		for (let i = 0; i < lines.length; i++) {
			const offsetY = lineHeight * (i - (lines.length - 1) / 2)
			this.ctx.fillText(lines[i], cx, cy + offsetY, usableWidth)
		}
	}

	private wrapTextLocal(text: string, maxWidth: number): string[] {
		return wrapText(text, maxWidth, (t) => this.ctx.measureText(t).width)
	}
}

/** Convert an Artist to physics bubble parameters with a random radius. */
function toBubbleParams(artist: Artist): BubbleArtistParams {
	return {
		artist,
		radius: 30 + Math.random() * 15,
	}
}

/**
 * Wrap text to fit within maxWidth, supporting both space-delimited
 * and character-boundary wrapping for long words.
 *
 * @param measureFn - returns the rendered width of a string (e.g. ctx.measureText(t).width)
 */
export function wrapText(
	text: string,
	maxWidth: number,
	measureFn: (text: string) => number,
): string[] {
	if (!text) return [text]

	// Split by whitespace first
	const words = text.split(/\s+/)

	const lines: string[] = []
	let current = ''

	for (let w = 0; w < words.length; w++) {
		const word = words[w]
		const separator = current ? ' ' : ''
		const trial = current + separator + word

		if (measureFn(trial) <= maxWidth) {
			current = trial
		} else {
			// Current line is full — push it if non-empty
			if (current) lines.push(current)

			// If this single word exceeds maxWidth, break by character
			if (measureFn(word) > maxWidth) {
				let charLine = ''
				for (const ch of word) {
					const charTrial = charLine + ch
					if (charLine && measureFn(charTrial) > maxWidth) {
						lines.push(charLine)
						charLine = ch
					} else {
						charLine = charTrial
					}
				}
				current = charLine
			} else {
				current = word
			}
		}
	}
	if (current) lines.push(current)

	// Anti-orphan: if the last line has 1-2 characters, merge back from previous line
	if (lines.length >= 2) {
		const lastLine = lines[lines.length - 1]
		const lastCharCount = [...lastLine].length
		if (lastCharCount <= 2) {
			const prev = lines[lines.length - 2]
			const prevChars = [...prev]
			// Move enough characters from prev to make last line >= 3 chars
			const moveCount = Math.min(3 - lastCharCount, prevChars.length - 1)
			if (moveCount > 0) {
				lines[lines.length - 2] = prevChars
					.slice(0, prevChars.length - moveCount)
					.join('')
				lines[lines.length - 1] =
					prevChars.slice(prevChars.length - moveCount).join('') + lastLine
			}
		}
	}

	return lines.length > 0 ? lines : [text]
}
