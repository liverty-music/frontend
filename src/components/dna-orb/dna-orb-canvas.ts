import {
	bindable,
	ILogger,
	INode,
	resolve,
	shadowCSS,
	useShadowDOM,
} from 'aurelia'
import { artistHue as hashArtistHue } from '../../adapter/view/artist-color'
import type { Artist } from '../../entities/artist'
import { IAudioEngine } from '../../services/audio-engine'
import {
	onReducedMotionChange,
	prefersReducedMotion,
} from '../../util/prefers-reduced-motion'
import { AbsorptionAnimator } from './absorption-animator'
import {
	type BubbleArtistParams,
	BubblePhysics,
	type PhysicsBubble,
} from './bubble-physics'
import { OrbRenderer } from './orb-renderer'
import { TapEffects } from './tap-effects'

/** Haptic pulse duration (ms) for a bubble tap. */
const HAPTIC_TAP_MS = 10

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
	@bindable public artists: Artist[] = []
	// Spawn-origin hints for a tap top-up (bound from the field owner). Read in
	// `artistsChanged` so newly-added ids pop outward from the tap point. Bound
	// alongside `artists`; the owner publishes it BEFORE the field so it is
	// current when `artistsChanged` fires.
	@bindable public placements: ReadonlyMap<string, { x: number; y: number }> =
		new Map()

	private readonly element = resolve(INode) as HTMLElement
	private canvas!: HTMLCanvasElement
	private ctx!: CanvasRenderingContext2D
	private animFrameId = 0
	private lastTime = 0
	private paused = false

	private physics = new BubblePhysics()
	private orbRenderer = new OrbRenderer()
	private absorptionAnimator = new AbsorptionAnimator()
	private tapEffects = new TapEffects()

	private readonly audio = resolve(IAudioEngine)
	private readonly logger = resolve(ILogger).scopeTo('DnaOrbCanvas')
	private reducedMotionUnsub: (() => void) | null = null
	// One-shot observer that waits for a non-zero layout size before the first
	// physics init/paint when the element attaches at 0×0 (SPA re-entry).
	private sizeObserver: ResizeObserver | null = null
	// Set in `detaching` so a still-pending `initWhenSized` bails after the wait.
	private detached = false

	private focusedBubbleIndex = -1
	private isProcessing = false

	// Per-artist hue memo: hue is a pure function of the artist, so compute it
	// once (keyed by id, falling back to name) instead of re-hashing the name on
	// every render frame per bubble. Survives the ghost→real reference swap.
	private readonly hueByArtist = new Map<string, number>()

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
		// If there are ghost placeholder bodies, swap them in-place for real artists
		// so bubbles stay at their current physics positions.
		const hasGhosts = newVal.some((a) => a.isGhost)
		if (!hasGhosts) {
			// Real-artist field: reconcile the rendered bodies to exactly this set.
			// The physics layer keeps matching bodies, fades out stale ones, and
			// adds new ones — capping only against live bodies so members are not
			// dropped while stale bodies are still fading out.
			const dropped = this.physics.reconcile(
				newVal.map((a) => toBubbleParams(a)),
				{ placements: this.placements },
			)
			if (dropped > 0) {
				this.logger.warn(
					'Bubble reconcile hit the hard capacity ceiling; some artists were not rendered',
					{ dropped },
				)
			}
			return
		}
		const params = newVal.map((a) => toBubbleParams(a))
		this.physics.addBubbles(params)
	}

	public async attached(): Promise<void> {
		this.detached = false
		const ctx = this.canvas.getContext('2d')
		if (!ctx) {
			this.logger.error('Failed to get 2D context')
			return
		}
		this.ctx = ctx

		// Honor prefers-reduced-motion for the visual micro-interactions only;
		// audio is gated solely by the SE setting / device mute switch. React to
		// live OS changes so the user need not reload to take effect.
		this.applyReducedMotion(prefersReducedMotion())
		this.reducedMotionUnsub = onReducedMotionChange((reduced) =>
			this.applyReducedMotion(reduced),
		)

		window.addEventListener('resize', this.onResize)
		this.canvas.addEventListener('pointerdown', this.onPointerDown)
		this.canvas.addEventListener('keydown', this.onKeyDown)

		// On SPA re-entry the element can still be 0×0 at `attached()`; `resize()`
		// would then skip `physics.init()`, and painting into an uninitialized
		// physics layer produced bodyless bubbles (render crash, empty canvas).
		// Wait for a real layout size before initializing + the first paint.
		await this.initWhenSized()
		if (this.detached) return // detached while waiting for layout
		this.physics.addBubbles(this.artists.map((a) => toBubbleParams(a)))

		this.lastTime = performance.now()
		this.animFrameId = requestAnimationFrame(this.loop)
	}

	/**
	 * Resolve once the host element has a non-zero layout size, then run the
	 * initial `resize()` (which initializes the physics engine). Immediate when
	 * already laid out; otherwise a one-shot `ResizeObserver` waits for the first
	 * non-zero size (SPA route-enter before layout).
	 */
	private async initWhenSized(): Promise<void> {
		const rect = this.element.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) {
			await new Promise<void>((resolve) => {
				this.sizeObserver = new ResizeObserver(() => {
					const r = this.element.getBoundingClientRect()
					if (r.width > 0 && r.height > 0) {
						this.sizeObserver?.disconnect()
						this.sizeObserver = null
						resolve()
					}
				})
				this.sizeObserver.observe(this.element)
			})
			if (this.detached) return
		}
		await this.resize()
	}

	public detaching(): void {
		this.detached = true
		this.sizeObserver?.disconnect()
		this.sizeObserver = null
		cancelAnimationFrame(this.animFrameId)
		window.removeEventListener('resize', this.onResize)
		this.canvas.removeEventListener('pointerdown', this.onPointerDown)
		this.canvas.removeEventListener('keydown', this.onKeyDown)
		this.physics.destroy()
		this.reducedMotionUnsub?.()
		this.reducedMotionUnsub = null
		// Release the audio hardware on route deactivation; the next tap
		// re-unlocks the context within that gesture.
		this.audio.suspend()
	}

	/** Apply the reduced-motion preference to the visual micro-interactions. */
	private applyReducedMotion(reduced: boolean): void {
		this.tapEffects.reducedMotion = reduced
		this.absorptionAnimator.elastic = !reduced
		this.absorptionAnimator.reducedMotion = reduced
	}

	/**
	 * Immediate tap feedback shared by direct taps and search-triggered follows:
	 * unlock the audio context (within the gesture), play the tap tone, and pulse
	 * the haptic. Keeps the two entry points feeling identical.
	 */
	private emitTapFeedback(hue: number): void {
		this.audio.unlock()
		this.audio.playTap(hue)
		this.vibrate(HAPTIC_TAP_MS)
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

	/**
	 * Spawn a bubble for a search-followed artist and absorb it into the orb.
	 * Defers the canvas read until the element is visible via
	 * `requestAnimationFrame` so a follow-absorb never reads a `0×0` canvas and
	 * spawns at `(0,0)` (the search→bubble view transition may not have laid out
	 * the canvas yet). Membership is handled separately by the field owner
	 * (`store.remove`) — this is a transient flourish, not a field addition.
	 */
	public spawnAndAbsorbAfterSearch(artist: Artist): void {
		requestAnimationFrame(() => {
			const rect = this.element.getBoundingClientRect()
			if (rect.width === 0 || rect.height === 0) {
				this.logger.warn('Canvas still hidden after rAF, skipping absorption')
				return
			}
			this.spawnAndAbsorb(artist, rect.width / 2, rect.height * 0.17)
		})
	}

	/**
	 * Spawn a temporary bubble and immediately absorb it into the orb.
	 * Used when following an artist from search results.
	 */
	private spawnAndAbsorb(artist: Artist, x: number, y: number): void {
		const id = artist.id
		const name = artist.name
		const radius = 30 + Math.random() * 15
		const hue = this.artistHue(artist)
		// Reuse the same feedback path as a direct tap so search-triggered
		// follows sound and feel identical.
		this.emitTapFeedback(hue)
		this.absorptionAnimator.startAbsorption(
			id,
			name,
			x,
			y,
			this.orbRenderer.orbX,
			this.orbRenderer.orbY,
			radius,
			hue,
			(completedHue) => this.onAbsorbComplete(completedHue),
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
			const hue = this.artistHue(artist)
			const radius = bubble.radius

			// Frame 0: immediate, coincident tap feedback (audio "puryu" + haptic).
			this.emitTapFeedback(hue)

			// Remove from physics; the over-inflation holds the bubble's place
			// while it swells, then ruptures: at the peak the bubble bursts (bright
			// ring + color-droplet spray) and absorption into the orb begins.
			this.physics.removeBubble(artistId)
			this.tapEffects.addPress(pos.x, pos.y, radius, hue, () => {
				this.tapEffects.addRupture(pos.x, pos.y, radius, hue)
				this.absorptionAnimator.spawnBurst(pos.x, pos.y, hue)
				this.absorptionAnimator.startAbsorption(
					artistId,
					artistName,
					pos.x,
					pos.y,
					this.orbRenderer.orbX,
					this.orbRenderer.orbY,
					radius,
					hue,
					(completedHue) => this.onAbsorbComplete(completedHue),
				)
			})

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

	/**
	 * Shared absorption-completion feedback: inject the artist color, fire the
	 * orb shockwave, and play the synced landing tone — all on the same frame.
	 */
	private onAbsorbComplete(hue: number): void {
		this.orbRenderer.injectColor(hue)
		if (this.orbRenderer.getStageParams().shockwaveEnabled) {
			this.orbRenderer.spawnShockwave(hue)
		}
		this.audio.playLanding(hue)
	}

	/** Trigger a brief haptic pulse where the Vibration API is available. */
	private vibrate(ms: number): void {
		if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
			try {
				navigator.vibrate(ms)
			} catch {
				// Vibration may be blocked by the platform; ignore.
			}
		}
	}

	private readonly loop = (time: number): void => {
		const delta = Math.min(time - this.lastTime, 32) // Cap at ~30fps min to prevent physics explosions on tab-switch/GC pauses
		this.lastTime = time

		this.monitorPerformance(delta)

		this.physics.update(delta)
		this.orbRenderer.update(delta)
		this.absorptionAnimator.update(delta)
		this.tapEffects.update(delta)

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

		// Layer 2.5: Tap ripples + squash-and-stretch press ghosts
		this.tapEffects.render(this.ctx)

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

	/** Memoized per-artist hue (keyed by id, falling back to name). */
	private artistHue(artist: Artist): number {
		const key = artist.id || artist.name
		const cached = this.hueByArtist.get(key)
		if (cached !== undefined) return cached
		const hue = hashArtistHue(artist.name)
		this.hueByArtist.set(key, hue)
		return hue
	}

	private renderBubble(bubble: PhysicsBubble, focused: boolean): void {
		const { body, artist, radius, scale, opacity } = bubble
		const x = body.position.x
		const y = body.position.y
		const r = radius * scale
		const artistName = artist.name

		if (r < 1 || opacity < 0.01) return

		this.ctx.save()

		// Ghost bubbles: translucent placeholder shown during loading — no label.
		if (artist.isGhost) {
			this.ctx.globalAlpha = opacity * 0.35
			const ghostGrad = this.ctx.createRadialGradient(
				x - r * 0.25,
				y - r * 0.25,
				0,
				x,
				y,
				r,
			)
			ghostGrad.addColorStop(0, 'hsla(260, 40%, 65%, 0.6)')
			ghostGrad.addColorStop(0.7, 'hsla(250, 30%, 45%, 0.4)')
			ghostGrad.addColorStop(1, 'hsla(240, 20%, 30%, 0.2)')
			this.ctx.fillStyle = ghostGrad
			this.ctx.beginPath()
			this.ctx.arc(x, y, r, 0, Math.PI * 2)
			this.ctx.fill()
			this.ctx.save()
			this.ctx.shadowBlur = r * 0.35
			this.ctx.shadowColor = 'rgba(180, 160, 255, 0.25)'
			this.ctx.strokeStyle = 'rgba(180, 160, 255, 0.05)'
			this.ctx.lineWidth = 2
			this.ctx.beginPath()
			this.ctx.arc(x, y, r, 0, Math.PI * 2)
			this.ctx.stroke()
			this.ctx.restore()
			this.ctx.restore()
			return
		}

		this.ctx.globalAlpha = opacity

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
		const hue = this.artistHue(artist)
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

		// Artist name fades in during the second half of the spawn so color
		// fills the bubble before text bleeds through.
		if (opacity > 0.55) {
			this.ctx.globalAlpha = Math.min(1, (opacity - 0.55) / 0.45)
			this.renderBubbleText(artistName, x, y, r)
			this.ctx.globalAlpha = opacity
		}

		// Soft bubble rim: shadowBlur blooms the stroke outward, mimicking the
		// way a real soap bubble has a glowing, blurry edge rather than a hard line.
		this.ctx.save()
		this.ctx.shadowBlur = r * 0.35
		this.ctx.shadowColor = 'rgba(255, 255, 255, 0.35)'
		this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
		this.ctx.lineWidth = 2
		this.ctx.beginPath()
		this.ctx.arc(x, y, r, 0, Math.PI * 2)
		this.ctx.stroke()
		this.ctx.restore()

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
