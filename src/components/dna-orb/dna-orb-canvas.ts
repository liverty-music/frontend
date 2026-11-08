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
import { IAnalyticsService } from '../../lib/analytics/analytics-service'
import { Events } from '../../services/analytics-events'
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
import { BubbleSprites, type Sprite } from './bubble-sprites'
import { FrameTimings } from './frame-timings'
import { OrbRenderer } from './orb-renderer'
import {
	LABEL_OPACITY_THRESHOLD,
	type RevealFrame,
	RevealMarks,
} from './reveal-marks'
import {
	computeLabelLayout,
	type LabelLayout,
	paintBubbleBody,
	paintGhostBody,
	paintLabel,
} from './sprite-paint'
import { TapEffects } from './tap-effects'

export {
	computeLabelLayout,
	type LabelLayout,
	wrapText,
} from './sprite-paint'

/** What `renderBubble` put on screen for one bubble. */
type Drawn = 'nothing' | 'body' | 'body-and-name'

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
	// Each bubble's body and name, painted once and pasted every frame.
	private readonly sprites = new BubbleSprites()
	// Frame intervals of this visit, sent once as `perf.discovery_frames`.
	private readonly frameTimings = new FrameTimings()
	// The next frame follows a (re)start of the loop: its interval is not a frame.
	private loopRestarted = true
	// Pending `audio.prepare()` (an idle callback id, or a timer id as a fallback).
	private audioPrepareHandle = 0
	private audioPrepareIsTimer = false
	// The canvas size in CSS px, read on layout only (never per frame).
	private viewWidth = 0
	private viewHeight = 0

	private readonly audio = resolve(IAudioEngine)
	private readonly analytics = resolve(IAnalyticsService)
	private readonly haptic = resolve(IHapticService)
	private readonly logger = resolve(ILogger).scopeTo('DnaOrbCanvas')
	private reducedMotionUnsub: (() => void) | null = null
	// One-shot observer that waits for a non-zero layout size before the first
	// physics init/paint when the element attaches at 0×0 (SPA re-entry).
	private sizeObserver: ResizeObserver | null = null
	/** Space kept clear under the orb, read from `--orb-floor` on each layout. */
	private floorInset = 0
	/** Re-lays the canvas out whenever the element's size changes. */
	private layoutObserver: ResizeObserver | null = null
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

	public constructor() {
		// The absorbing bubble pastes its own name sprite, scaled, instead of
		// laying its name out again at a new size every frame.
		this.absorptionAnimator.drawLabel = (name, x, y, radius, scale) => {
			const sprite = this.sprites.label(name, radius)
			if (!sprite) return false
			this.drawSprite(sprite, x, y, scale)
			return true
		}
	}

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
			this.requestFieldSprites()
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
		this.requestFieldSprites()
	}

	/**
	 * Ask for the sprites of every bubble on the field or queued to enter it,
	 * so they are painted before the bubbles need them. With a worker they are
	 * sent at once; on the main thread the frames paint a few at a time.
	 */
	private requestFieldSprites(): void {
		const want = (artist: Artist, radius: number) => {
			if (artist.isGhost) {
				this.sprites.ghost(radius)
				return
			}
			this.sprites.body(radius, this.artistHue(artist))
			this.sprites.label(artist.name, radius)
		}
		for (const b of this.physics.getBubbles()) want(b.artist, b.radius)
		for (const p of this.physics.pendingSpawnParams()) want(p.artist, p.radius)
		if (this.sprites.offMainThread) this.sprites.flush()
	}

	public async attached(): Promise<void> {
		this.detached = false
		const ctx = this.canvas.getContext('2d')
		if (!ctx) {
			this.logger.error('Failed to get 2D context')
			return
		}
		this.ctx = ctx
		// Start the sprite worker now, so its module has loaded by the time the
		// artists arrive.
		this.sprites.start()
		this.scheduleAudioPrepare()
		document.addEventListener('visibilitychange', this.onVisibilityChange)

		// Honor prefers-reduced-motion for the visual micro-interactions only;
		// audio is gated solely by the SE setting / device mute switch. React to
		// live OS changes so the user need not reload to take effect.
		this.applyReducedMotion(prefersReducedMotion())
		this.reducedMotionUnsub = onReducedMotionChange((reduced) =>
			this.applyReducedMotion(reduced),
		)

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
		this.loopRestarted = true
		this.animFrameId = requestAnimationFrame(this.loop)

		await this.initPhysics(width, height)
		if (this.detached) return
		// Follow the element's own size from now on, not the window's: the field
		// changes height when a row above it appears or changes (the onboarding
		// progress row, search mode), and the orb at its bottom must stay in view.
		this.layoutObserver = new ResizeObserver(this.onResize)
		this.layoutObserver.observe(this.element)
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
			this.requestFieldSprites()
		}
	}

	/**
	 * Build the audio graph within 1 s of opening Discovery, off the first
	 * tap's handler. The context stays suspended until the tap's `unlock()`.
	 */
	private scheduleAudioPrepare(): void {
		const prepare = () => {
			this.audioPrepareHandle = 0
			this.audio.prepare()
		}
		if (typeof requestIdleCallback === 'function') {
			this.audioPrepareIsTimer = false
			this.audioPrepareHandle = requestIdleCallback(prepare, { timeout: 1000 })
		} else {
			this.audioPrepareIsTimer = true
			this.audioPrepareHandle = window.setTimeout(prepare, 1000)
		}
	}

	private cancelAudioPrepare(): void {
		if (!this.audioPrepareHandle) return
		if (this.audioPrepareIsTimer) window.clearTimeout(this.audioPrepareHandle)
		else cancelIdleCallback(this.audioPrepareHandle)
		this.audioPrepareHandle = 0
	}

	/** Hiding the page ends the visit's frame measurement. */
	private readonly onVisibilityChange = (): void => {
		if (document.visibilityState === 'hidden') this.endFrameMeasurement()
	}

	/**
	 * End this visit's frame measurement and send its frame timings, once per
	 * visit and only when enough frames were measured. Called when the fan
	 * leaves Discovery, hides the page, or switches to the All Nearby view.
	 */
	public endFrameMeasurement(): void {
		const summary = this.frameTimings.finish()
		if (!summary) return
		this.analytics.capture(Events.DiscoveryFrames, {
			...summary,
			bubbles: this.physics.bubbleCount,
			names_off_main_thread: this.sprites.offMainThread,
		})
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
		this.endFrameMeasurement()
		this.detached = true
		this.settleSizeWait()
		cancelAnimationFrame(this.animFrameId)
		this.cancelAudioPrepare()
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.sprites.stop()
		this.layoutObserver?.disconnect()
		this.layoutObserver = null
		window.clearTimeout(this.resizeTimeout)
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
		this.loopRestarted = true
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
		// Read here, on layout, so a frame never forces one.
		this.viewWidth = rect.width
		this.viewHeight = rect.height
		this.sprites.setDpr(dpr)

		this.floorInset = this.readFloorInset()
		this.orbRenderer.init(rect.width, rect.height, this.floorInset)
		// Re-apply the current session activation level for the now-known canvas
		// width. `init()` alone leaves the orb at its width-agnostic default (radius
		// 60); this keeps the orb at whatever stage the session's follows have
		// reached (dormant stage 0 until the first follow).
		this.orbRenderer.applyLevel(this.activationLevel)
		return { width: rect.width, height: rect.height }
	}

	/**
	 * The space the page keeps clear under the orb (`--orb-floor`, a registered
	 * length, so it reads back in px): whatever overlaps the canvas bottom, such
	 * as the FAB in the navigation bar's notch on Discovery.
	 */
	private readFloorInset(): number {
		if (!(this.element instanceof Element)) return 0
		const value = getComputedStyle(this.element).getPropertyValue('--orb-floor')
		return Number.parseFloat(value) || 0
	}

	/** Load and size the physics engine for a `width` × `height` canvas. */
	private async initPhysics(width: number, height: number): Promise<void> {
		await this.physics.init(width, height, this.floorInset)
		// On narrow canvases the orb is smaller and bottom-anchored, so align the
		// physics floor with its top here; init() resets the bottom wall to a
		// width-agnostic default. Left untouched on wide canvases to preserve the
		// established layout.
		if (width < 390) {
			this.physics.updateOrbZone(this.orbRenderer.getStageParams().orbRadius)
		}
		this.physics.keepBubblesInside()
	}

	private resizeTimeout = 0
	/** Debounced so a run of size changes re-lays the canvas out once. */
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
		// The first frame after a (re)start measures the wait for it, not a frame.
		if (this.loopRestarted) this.loopRestarted = false
		else this.frameTimings.record(elapsed)

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
		const w = this.viewWidth
		const h = this.viewHeight
		if (w === 0 || h === 0) return

		this.ctx.clearRect(0, 0, w, h)

		// Layer 0: Ground glow (behind everything)
		this.orbRenderer.renderGroundGlow(this.ctx)

		// Layer 1: Light rays (additive blend, behind bubbles)
		this.orbRenderer.renderLightRays(this.ctx)

		// Layer 2: Bubbles (static placeholders until the physics engine is up)
		const bubbles = this.physicsReady
			? this.physics.getBubbles()
			: this.placeholders
		const counting = !this.revealMarks.done
		const frame: RevealFrame = { drawn: 0, named: 0, live: 0, liveNamed: 0 }
		for (let i = 0; i < bubbles.length; i++) {
			const drawn = this.renderBubble(bubbles[i], i === this.focusedBubbleIndex)
			if (!counting) continue
			const named = drawn === 'body-and-name'
			if (drawn !== 'nothing') frame.drawn++
			if (named) frame.named++
			if (bubbles[i].isFadingOut) continue
			frame.live++
			if (named) frame.liveNamed++
		}
		if (counting) this.reportRevealMarks(frame)

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

		// The sprites this frame asked for: to the worker, or a few painted here.
		this.sprites.flush()
	}

	/**
	 * Record each cold-load reveal milestone reached this frame as a
	 * `discovery:<mark>` performance mark and report it to the route through a
	 * `reveal-mark` event carrying the mark's time (ms since `timeOrigin`).
	 */
	private reportRevealMarks(frame: RevealFrame): void {
		for (const mark of this.revealMarks.observe(frame)) {
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

	/**
	 * Draw one bubble: its body and name pasted from sprites, scaled during the
	 * spawn. Until a sprite has been painted, a full-size bubble (a ghost
	 * turning into an artist) is drawn directly with the same paint code, so
	 * its name is never late; a bubble popping from a tap starts tiny and
	 * waits for its sprites. Returns what reached the screen.
	 */
	private renderBubble(bubble: PhysicsBubble, focused: boolean): Drawn {
		const { body, artist, radius, scale, opacity } = bubble
		const x = body.position.x
		const y = body.position.y
		const r = radius * scale

		if (r < 1 || opacity < 0.01) return 'nothing'

		const ctx = this.ctx
		const direct = scale >= 1

		// Ghost bubbles: translucent placeholder shown during loading — no label.
		if (artist.isGhost) {
			const sprite = this.sprites.ghost(radius)
			if (!sprite && !direct) return 'nothing'
			ctx.save()
			ctx.globalAlpha = opacity * GHOST_OPACITY
			if (sprite) this.drawSprite(sprite, x, y, scale)
			else paintGhostBody(ctx, x, y, r)
			ctx.restore()
			return 'body'
		}

		const hue = this.artistHue(artist)
		const bodySprite = this.sprites.body(radius, hue)
		// Asked for together with the body, so the name is not a round trip later.
		const labelSprite = this.sprites.label(artist.name, radius)
		if (!bodySprite && !direct) return 'nothing'

		ctx.save()
		ctx.globalAlpha = opacity

		// Focus ring for keyboard navigation
		if (focused) {
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
			ctx.lineWidth = 3
			ctx.setLineDash([4, 4])
			ctx.beginPath()
			ctx.arc(x, y, r + 4, 0, Math.PI * 2)
			ctx.stroke()
			ctx.setLineDash([])
		}

		if (bodySprite) this.drawSprite(bodySprite, x, y, scale)
		else paintBubbleBody(ctx, x, y, r, hue)

		// Artist name fades in during the second half of the spawn so color
		// fills the bubble before text bleeds through.
		let drawn: Drawn = 'body'
		if (opacity > LABEL_OPACITY_THRESHOLD) {
			if (labelSprite || direct) {
				ctx.globalAlpha = Math.min(
					1,
					(opacity - LABEL_OPACITY_THRESHOLD) / 0.45,
				)
				if (labelSprite) this.drawSprite(labelSprite, x, y, scale)
				else this.renderBubbleText(artist.name, x, y, radius, scale)
				drawn = 'body-and-name'
			}
		}

		ctx.restore()
		return drawn
	}

	/** Paste `sprite` centered on (`x`, `y`), scaled by `scale`. */
	private drawSprite(
		sprite: Sprite,
		x: number,
		y: number,
		scale: number,
	): void {
		const half = sprite.half * scale
		this.ctx.drawImage(sprite.image, x - half, y - half, half * 2, half * 2)
	}

	/**
	 * Draw a bubble's label laid out for its full `radius`, directly (no
	 * sprite yet). While the bubble is not at its full size the same layout is
	 * drawn scaled about the center; at full size it is drawn unscaled, pixel
	 * for pixel as laid out.
	 */
	private renderBubbleText(
		name: string,
		cx: number,
		cy: number,
		radius: number,
		scale: number,
	): void {
		const layout = this.labelLayout(name, radius)
		this.measureFont = ''
		if (scale === 1) {
			paintLabel(this.ctx, layout, radius, cx, cy)
			return
		}
		this.ctx.save()
		this.ctx.translate(cx, cy)
		this.ctx.scale(scale, scale)
		paintLabel(this.ctx, layout, radius, 0, 0)
		this.ctx.restore()
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
