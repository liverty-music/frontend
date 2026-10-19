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
import { displayCapacityFor } from '../../services/bubble-invariants'
import { IHapticService } from '../../services/haptic-service'
import {
	onReducedMotionChange,
	prefersReducedMotion,
} from '../../util/prefers-reduced-motion'
import { AbsorptionAnimator } from './absorption-animator'
import {
	type BubbleArtistParams,
	BubblePhysics,
	GHOST_OPACITY,
	type PhysicsBubble,
	randomSpawnPoint,
} from './bubble-physics'
import { OrbRenderer } from './orb-renderer'
import { LABEL_OPACITY_THRESHOLD, RevealMarks } from './reveal-marks'
import { TapEffects } from './tap-effects'

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
	// The user's TOTAL follow count, bound from the route. Retained for the route
	// contract, but it intentionally does NOT drive the orb: the orb's activation is
	// gesture-driven (see `activationLevel`), so a returning user who already follows
	// N artists still enters Discovery with a dormant orb.
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
	// False until the physics engine is loaded and initialized. Until then the
	// canvas draws the cold visit's ghosts as static placeholders, so the first
	// bubbles do not wait for the engine.
	private physicsReady = false
	private placeholders: PhysicsBubble[] = []
	private orbRenderer = new OrbRenderer()
	private absorptionAnimator = new AbsorptionAnimator()
	private tapEffects = new TapEffects()
	// Cold-load reveal milestones; a fresh component per mount starts a fresh set.
	private revealMarks = new RevealMarks()

	private readonly audio = resolve(IAudioEngine)
	private readonly haptic = resolve(IHapticService)
	private readonly logger = resolve(ILogger).scopeTo('DnaOrbCanvas')
	private reducedMotionUnsub: (() => void) | null = null
	// One-shot observer that waits for a non-zero layout size before the first
	// physics init/paint when the element attaches at 0×0 (SPA re-entry).
	private sizeObserver: ResizeObserver | null = null
	// Resolver for the size-wait promise, so `detaching()` can settle it (avoids a
	// forever-pending `attached()` when detached while still 0×0).
	private sizeResolve: (() => void) | null = null
	// Set in `detaching` so a still-pending `initWhenSized` bails after the wait.
	private detached = false

	private displayLimit = 50

	private focusedBubbleIndex = -1
	private isProcessing = false

	// Orb stage level derived from genuine follow gestures completed this session.
	// Starts at 0 (dormant) on entry and increments once per follow absorption, so
	// the orb activates ONLY in response to a real follow — never from the bound
	// total count or its non-gesture changes. Reset to 0 on every re-entry because a
	// fresh component (and renderer) is created per Discovery mount.
	private activationLevel = 0

	// Per-artist hue memo: hue is a pure function of the artist, so compute it
	// once (keyed by id, falling back to name) instead of re-hashing the name on
	// every render frame per bubble. Survives the ghost→real reference swap.
	private readonly hueByArtist = new Map<string, number>()

	// Label layout per `${name}|${radius}` (the bubble's full radius): the
	// shrink-and-wrap loop measures text many times, so it runs once per bubble,
	// not per frame. Keying on the drawn radius missed on every spawn frame.
	private readonly labelLayouts = new Map<string, LabelLayout>()
	// The font last set for measuring, so it is set only when it changes;
	// cleared at the start of each frame and whenever a label is drawn.
	private measureFont = ''

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

	/**
	 * Apply orb stage `level`: set the renderer's eased stage targets and mirror the
	 * derived physics orb-zone and comet-trail flag. Silent — no celebration.
	 *
	 * The orb's activation is GESTURE-DRIVEN: `level` is `activationLevel` (the count
	 * of genuine follow gestures completed this Discovery session), NOT the bound
	 * total `followedCount`. The orb therefore enters dormant (level 0) regardless of
	 * how many artists the user already follows, and grows one stage per real follow
	 * absorption — so it never reads as "activated" before a genuine follow (the
	 * bound total-count changes from hydration/migration/unfollow/rollback do not
	 * move the orb at all).
	 */
	private applyLevel(level: number): void {
		this.orbRenderer.applyLevel(level)
		const sp = this.orbRenderer.getStageParams()
		this.physics.updateOrbZone(sp.orbRadius)
		this.absorptionAnimator.cometTrailEnabled = sp.cometTrailEnabled
	}

	public artistsChanged(newVal: Artist[]): void {
		// Not attached, or physics not ready yet: attached() syncs the field once
		// the engine is up.
		if (!this.ctx || !this.physicsReady) return
		const shown = newVal.slice(0, this.displayLimit)
		const real = shown.filter((a) => !a.isGhost)
		// An all-ghost field is the cold-visit placeholder: paint it as is.
		if (real.length === 0 && shown.length > 0) {
			this.physics.addBubbles(shown.map((a) => toBubbleParams(a)))
			return
		}
		// Reconcile the rendered bodies to the field's real members: the physics
		// layer keeps matching bodies, fades out stale ones, and adds new ones in
		// ghost slots first (so bubbles stay where they are), capping only against
		// live bodies. While the field still holds ghosts (a progressive reveal),
		// leftover ghost bodies are kept for the artists still to come.
		const dropped = this.physics.reconcile(
			real.map((a) => toBubbleParams(a)),
			{
				placements: this.placements,
				keepGhosts: real.length < shown.length,
			},
		)
		if (dropped > 0) {
			this.logger.warn(
				'Bubble reconcile hit the hard capacity ceiling; some artists were not rendered',
				{ dropped },
			)
		}
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
		await this.waitForSize()
		if (this.detached) return // detached while waiting for layout
		const { width, height } = this.sizeCanvas()

		// A cold visit's ghosts are drawn at once as static placeholders, and the
		// frame loop starts now: the first bubbles need no physics engine.
		this.placeholders = this.artists
			.slice(0, this.displayLimit)
			.filter((a) => a.isGhost)
			.map((a) => placeholderBubble(a, width, height))
		this.lastTime = performance.now()
		this.animFrameId = requestAnimationFrame(this.loop)

		await this.initPhysics(width, height)
		if (this.detached) return
		// Seed the orb DORMANT on entry (stage 0) regardless of the user's total
		// follow count — the orb must not read as "activated" before a genuine follow
		// this session. It grows only via `onAbsorbComplete` (a real follow gesture).
		this.applyLevel(this.activationLevel)
		// Physics takes over: the placeholders become ghost bodies where they are
		// drawn, then the field is synced (real artists reveal into ghost slots).
		this.physics.addBubbles(
			this.placeholders.map((b) => ({
				artist: b.artist,
				radius: b.radius,
				position: b.body.position,
			})),
		)
		this.placeholders = []
		this.physicsReady = true
		const shown = this.artists.slice(0, this.displayLimit)
		if (shown.some((a) => !a.isGhost)) {
			this.artistsChanged(this.artists)
		} else {
			this.physics.addBubbles(shown.map((a) => toBubbleParams(a)))
		}
	}

	/**
	 * Resolve once the host element has a non-zero layout size. Immediate when
	 * already laid out; otherwise a one-shot `ResizeObserver` waits for the first
	 * non-zero size (SPA route-enter before layout).
	 */
	private async waitForSize(): Promise<void> {
		const rect = this.element.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) {
			await new Promise<void>((resolve) => {
				// Capture the resolver so `detaching()` can settle this wait too —
				// otherwise a detach while still 0×0 would leave the promise (and the
				// component it closes over) pending forever, and the `detached` guard
				// below would be unreachable.
				this.sizeResolve = resolve
				this.sizeObserver = new ResizeObserver(() => {
					const r = this.element.getBoundingClientRect()
					if (r.width > 0 && r.height > 0) this.settleSizeWait()
				})
				this.sizeObserver.observe(this.element)
			})
		}
	}

	/** Stop the size wait: disconnect the observer and resolve the pending promise. */
	private settleSizeWait(): void {
		this.sizeObserver?.disconnect()
		this.sizeObserver = null
		this.sizeResolve?.()
		this.sizeResolve = null
	}

	public detaching(): void {
		this.detached = true
		this.settleSizeWait()
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
		this.haptic.tap()
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
		const rect = this.element.getBoundingClientRect()
		if (!rect || rect.width === 0 || rect.height === 0) return
		const { width, height } = this.sizeCanvas()
		await this.initPhysics(width, height)
	}

	/**
	 * Size the canvas backing store and the orb to the element (synchronous; no
	 * physics), so the first frame can be drawn before the engine loads.
	 */
	private sizeCanvas(): { width: number; height: number } {
		// Capped at 2: a 3x screen would raster 2.25x the pixels of 2x every
		// frame for bubbles whose edges are soft anyway.
		const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR)
		const rect = this.element.getBoundingClientRect()
		this.displayLimit = displayCapacityFor(rect.width)

		this.canvas.width = rect.width * dpr
		this.canvas.height = rect.height * dpr
		this.canvas.style.width = `${rect.width}px`
		this.canvas.style.height = `${rect.height}px`
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

		this.orbRenderer.init(rect.width, rect.height)
		// Re-apply the current session activation level for the now-known canvas
		// width. `init()` alone leaves the orb at its width-agnostic default (radius
		// 60); this keeps the orb at whatever stage the session's follows have
		// reached (dormant stage 0 until the first follow).
		this.orbRenderer.applyLevel(this.activationLevel)
		return { width: rect.width, height: rect.height }
	}

	/** Load and size the physics engine for a `width` × `height` canvas. */
	private async initPhysics(width: number, height: number): Promise<void> {
		await this.physics.init(width, height)
		// On narrow canvases the orb is smaller and bottom-anchored, so align the
		// physics floor with its top here; init() resets the bottom wall to a
		// width-agnostic default. Left untouched on wide canvases to preserve the
		// established layout.
		if (width < 390) {
			this.physics.updateOrbZone(this.orbRenderer.getStageParams().orbRadius)
		}
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
				this.focusedBubbleIndex = nextFocusableIndex(
					bubbles,
					this.focusedBubbleIndex,
					1,
				)
				break
			}
			case 'ArrowLeft':
			case 'ArrowUp': {
				e.preventDefault()
				this.focusedBubbleIndex = nextFocusableIndex(
					bubbles,
					this.focusedBubbleIndex,
					-1,
				)
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
	 * Sole trigger for the orb's activation: a genuine follow gesture's bubble
	 * absorption completing. Advances the orb one stage (session-scoped
	 * `activationLevel`, eased) and fires the unified celebration (pulse/strobe +
	 * color injection + stage-gated shockwave) and the synced landing tone on the
	 * same frame. Because both the growth and the celebration originate here, the orb
	 * activates only on a real follow — never on entry or a non-gesture count change.
	 */
	private onAbsorbComplete(hue: number): void {
		this.activationLevel++
		this.applyLevel(this.activationLevel)
		this.orbRenderer.celebrate(hue)
		this.audio.playLanding(hue)
	}

	private readonly loop = (time: number): void => {
		const elapsed = time - this.lastTime
		const delta = Math.min(elapsed, 32) // Cap at ~30fps min to prevent physics explosions on tab-switch/GC pauses
		this.lastTime = time

		this.monitorPerformance(delta)

		// Physics steps by the capped delta; the spawn and fade progress follow
		// real elapsed time, so a name fades in on time even when frames are slow.
		this.physics.update(delta, elapsed)
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
		// Other layers (absorption labels) set their own fonts while drawing.
		this.measureFont = ''
		const rect = this.element.getBoundingClientRect()
		if (!rect || rect.width === 0 || rect.height === 0) return

		const w = rect.width
		const h = rect.height

		this.ctx.clearRect(0, 0, w, h)

		// Layer 0: Ground glow (behind everything)
		this.orbRenderer.renderGroundGlow(this.ctx)

		// Layer 1: Light rays (additive blend, behind bubbles)
		this.orbRenderer.renderLightRays(this.ctx)

		// Layer 2: Bubbles (static placeholders until the physics engine is up)
		const bubbles = this.physicsReady
			? this.physics.getBubbles()
			: this.placeholders
		for (let i = 0; i < bubbles.length; i++) {
			this.renderBubble(bubbles[i], i === this.focusedBubbleIndex)
		}
		this.reportRevealMarks(bubbles)

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

	/**
	 * Record each cold-load reveal milestone reached this frame as a
	 * `discovery:<mark>` performance mark and report it to the route through a
	 * `reveal-mark` event carrying the mark's time (ms since `timeOrigin`).
	 */
	private reportRevealMarks(bubbles: readonly PhysicsBubble[]): void {
		for (const mark of this.revealMarks.observe(bubbles)) {
			const time = performance.mark(`discovery:${mark}`).startTime
			this.element.dispatchEvent(
				new CustomEvent('reveal-mark', {
					bubbles: true,
					detail: { mark, time },
				}),
			)
		}
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
			this.ctx.globalAlpha = opacity * GHOST_OPACITY
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
		if (opacity > LABEL_OPACITY_THRESHOLD) {
			this.ctx.globalAlpha = Math.min(
				1,
				(opacity - LABEL_OPACITY_THRESHOLD) / 0.45,
			)
			this.renderBubbleText(artistName, x, y, radius, scale)
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

	/**
	 * Draw a bubble's label laid out for its full `radius`. While the bubble
	 * spawns (`scale` ≠ 1) the same layout is drawn scaled about the center, so
	 * the label is laid out once per bubble instead of once per spawn frame;
	 * at full size it is drawn unscaled, pixel for pixel as laid out.
	 */
	private renderBubbleText(
		name: string,
		cx: number,
		cy: number,
		radius: number,
		scale: number,
	): void {
		const layout = this.labelLayout(name, radius)

		this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
		this.ctx.textAlign = 'center'
		this.ctx.textBaseline = 'middle'
		this.ctx.font = layout.font
		this.measureFont = ''

		const scaled = scale !== 1
		if (scaled) {
			this.ctx.save()
			this.ctx.translate(cx, cy)
			this.ctx.scale(scale, scale)
		}
		const ox = scaled ? 0 : cx
		const oy = scaled ? 0 : cy
		const { lines, lineHeight } = layout
		const usableWidth = radius * 1.6
		for (let i = 0; i < lines.length; i++) {
			const offsetY = lineHeight * (i - (lines.length - 1) / 2)
			this.ctx.fillText(lines[i], ox, oy + offsetY, usableWidth)
		}
		if (scaled) this.ctx.restore()
	}

	/** Cached `computeLabelLayout`, keyed by name and full radius. */
	private labelLayout(name: string, radius: number): LabelLayout {
		const key = `${name}|${radius}`
		const cached = this.labelLayouts.get(key)
		if (cached) return cached
		if (this.labelLayouts.size >= LABEL_LAYOUT_CACHE_LIMIT) {
			this.labelLayouts.clear()
		}
		const layout = computeLabelLayout(name, radius, (text, font) => {
			if (this.measureFont !== font) {
				this.ctx.font = font
				this.measureFont = font
			}
			return this.ctx.measureText(text).width
		})
		this.labelLayouts.set(key, layout)
		return layout
	}
}

// Device pixel ratio the canvas renders at, at most.
const MAX_CANVAS_DPR = 2

// Bound on cached label layouts over a long session of taps.
const LABEL_LAYOUT_CACHE_LIMIT = 1000

// Font size labels are measured at before scaling to the size tried.
const LABEL_REF_SIZE = 100

/** The canvas font of a bubble label at `size` px. */
function labelFont(size: number): string {
	return `bold ${size}px system-ui, sans-serif`
}

/** How a bubble label is drawn: its font, its wrapped lines and line spacing. */
export interface LabelLayout {
	font: string
	lines: string[]
	lineHeight: number
}

/**
 * Lay out a bubble's artist name: wrap it to 1.6× the radius, shrinking the
 * font by 0.5 px from `radius * 0.38` (min 10 px) until every line fits and
 * there are at most 3 lines; then truncate to 3 lines.
 *
 * @param measure - rendered width of `text` in `font` (e.g. ctx.measureText)
 */
export function computeLabelLayout(
	name: string,
	radius: number,
	measure: (text: string, font: string) => number,
): LabelLayout {
	const usableWidth = radius * 1.6
	const minFont = 10
	const maxLines = 3

	// The sizes the shrink loop steps through: from `radius * 0.38` (at least
	// the floor) down by 0.5 px, ending at the first size at or below the
	// floor, which is used whether or not the label fits. Built by repeated
	// subtraction so every size is the exact float the loop would try.
	const sizes: number[] = []
	for (let size = Math.max(minFont, radius * 0.38); ; size -= 0.5) {
		sizes.push(size)
		if (size <= minFont) break
	}

	// Every string is measured once, at one reference size, and scaled to the
	// size being tried: text width grows in proportion to the font size, and
	// switching the canvas font for each size was the costly part (561 ms of
	// measureText for a guest's 30 labels at 4x CPU throttling).
	const refWidths = new Map<string, number>()
	const refWidth = (text: string): number => {
		let w = refWidths.get(text)
		if (w === undefined) {
			w = measure(text, labelFont(LABEL_REF_SIZE))
			refWidths.set(text, w)
		}
		return w
	}
	const layoutAt = (fontSize: number) => {
		const scale = fontSize / LABEL_REF_SIZE
		const width = (t: string) => refWidth(t) * scale
		const lines = wrapText(name, usableWidth, width)
		const fits =
			lines.length <= maxLines &&
			lines.every((line) => width(line) <= usableWidth)
		return { font: labelFont(fontSize), lines, fits }
	}

	// The largest size that fits, by binary search over the steps instead of
	// trying them one by one. Text width grows with the font size, so "fits"
	// holds from some step on and the search lands on the step the one-by-one
	// loop would stop at (checked by the parity test). The last step is the
	// floor.
	let lo = 0
	let hi = sizes.length - 1
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (layoutAt(sizes[mid]).fits) hi = mid
		else lo = mid + 1
	}
	const fontSize = sizes[lo]
	let { font, lines } = layoutAt(fontSize)

	// Truncate to maxLines if still exceeded after font floor
	if (lines.length > maxLines) {
		lines = lines.slice(0, maxLines)
	}

	return { font, lines, lineHeight: fontSize * 1.25 }
}

/**
 * The index the keyboard focus moves to from `from` in direction `step`,
 * skipping ghost placeholders (they ignore input). Returns -1 when no bubble
 * can take focus.
 */
export function nextFocusableIndex(
	bubbles: readonly PhysicsBubble[],
	from: number,
	step: 1 | -1,
): number {
	const n = bubbles.length
	let i = from < 0 && step === -1 ? n : from
	for (let tries = 0; tries < n; tries++) {
		i = (((i + step) % n) + n) % n
		const b = bubbles[i]
		if (!b.artist.isGhost && !b.isFadingOut) return i
	}
	return -1
}

/**
 * A ghost drawn before the physics engine is up: a static bubble at a random
 * spawn point, handed to the engine at the same place once it loads.
 */
function placeholderBubble(
	artist: Artist,
	width: number,
	height: number,
): PhysicsBubble {
	return {
		body: {
			position: randomSpawnPoint(width, height),
		} as PhysicsBubble['body'],
		artist,
		radius: 30 + Math.random() * 15,
		scale: 1,
		opacity: 1,
		isSpawning: false,
		spawnProgress: 1,
		isFadingOut: false,
		fadeOutProgress: 0,
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
