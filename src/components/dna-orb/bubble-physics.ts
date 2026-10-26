import type Matter from 'matter-js'
import type { Artist } from '../../entities/artist'
import { MAX_BUBBLES } from '../../services/bubble-invariants'
import { easeOutBack } from './easing'

/** A physics-enabled bubble wrapping an Artist with position and radius. */
export interface PhysicsBubble {
	body: Matter.Body
	artist: Artist
	radius: number
	scale: number
	opacity: number
	isSpawning: boolean
	spawnProgress: number
	/**
	 * The spawn is a ghost turning into its artist in place: full size from
	 * the start, fading up from the ghost's opacity, instead of the
	 * scale-from-zero pop of a new bubble.
	 */
	revealInPlace?: boolean
	isFadingOut: boolean
	fadeOutProgress: number
}

/** A ghost placeholder is drawn at this share of its opacity. */
export const GHOST_OPACITY = 0.35
// An in-place reveal fades from the ghost's opacity to 1 in about 150 ms, so
// the name (drawn above opacity 0.55) shows about 46 ms after the swap.
const REVEAL_IN_PLACE_SPEED = 1 / 150

/** Parameters for adding an artist to the physics simulation. */
export interface BubbleArtistParams {
	artist: Artist
	radius: number
	/** Where the body starts; a random spawn point when absent. */
	position?: { x: number; y: number }
}

/**
 * A random spawn point across the upper portion of a `width` × `height`
 * canvas. On narrow canvases the field is tall and the orb is small and
 * bottom-anchored, so it fills further down (80% vs 50%) to avoid a void
 * between the bubble cluster and the orb.
 */
export function randomSpawnPoint(
	width: number,
	height: number,
): { x: number; y: number } {
	const spawnFraction = width < 390 ? 0.8 : 0.5
	return {
		x: Math.random() * (width - 100) + 50,
		y: Math.random() * (height * spawnFraction) + 50,
	}
}

// The physics engine module, imported once per page and shared by every
// BubblePhysics instance. Reset on failure so a later call can retry.
let matterImport: Promise<typeof Matter> | null = null

/**
 * Start downloading the physics engine (memoized). Called from the Discovery
 * route's `loading()` so the chunk loads while the route is composed, before
 * the canvas is attached and sized.
 */
export function preloadPhysics(): Promise<typeof Matter> {
	matterImport ??= import('matter-js').then(
		(m) => m.default,
		(err: unknown) => {
			matterImport = null
			throw err
		},
	)
	return matterImport
}

export class BubblePhysics {
	private Matter: typeof Matter | null = null
	private engine: Matter.Engine | null = null
	private world: Matter.World | null = null
	private walls: Matter.Body[] = []
	private bubbleMap = new Map<string, PhysicsBubble>()

	private width = 0
	private height = 0
	private initPromise: Promise<void> | null = null
	private initGeneration = 0
	private fadeOutResolve: (() => void) | null = null
	private fadeOutPendingIds = new Set<string>()
	private bottomWall: Matter.Body | null = null

	/** Space kept clear above the canvas floor (see OrbRenderer.floorInset). */
	private floorInset = 0

	public async init(
		width: number,
		height: number,
		floorInset = 0,
	): Promise<void> {
		this.floorInset = floorInset
		if (this.initPromise) {
			this.width = width
			this.height = height
			return this.initPromise
		}

		this.width = width
		this.height = height
		const gen = ++this.initGeneration
		const promise = (async () => {
			// Lazy-load Matter.js on first init call
			if (!this.Matter) {
				this.Matter = await preloadPhysics()
				this.engine = this.Matter?.Engine.create({
					gravity: { x: 0, y: 0.15, scale: 0.001 },
				})
				this.world = this.engine.world
			}

			// Use this.width/this.height so concurrent callers' updates are picked up
			const w = this.width
			const h = this.height

			for (const wall of this.walls) {
				this.Matter?.Composite.remove(this.world, wall)
			}
			this.walls = []

			const wallThickness = 50
			const orbZoneHeight = 130
			this.bottomWall = this.Matter?.Bodies.rectangle(
				w / 2,
				h - this.floorInset - orbZoneHeight + wallThickness / 2,
				w,
				wallThickness,
				{ isStatic: true },
			)
			this.walls = [
				// Top
				this.Matter?.Bodies.rectangle(
					w / 2,
					-wallThickness / 2,
					w,
					wallThickness,
					{ isStatic: true },
				),
				// Left
				this.Matter?.Bodies.rectangle(
					-wallThickness / 2,
					h / 2,
					wallThickness,
					h,
					{ isStatic: true },
				),
				// Right
				this.Matter?.Bodies.rectangle(
					w + wallThickness / 2,
					h / 2,
					wallThickness,
					h,
					{ isStatic: true },
				),
				// Bottom (above orb zone)
				this.bottomWall,
			]
			if (gen !== this.initGeneration) return
			this.Matter?.Composite.add(this.world, this.walls)
		})().finally(() => {
			if (this.initPromise === promise) {
				this.initPromise = null
			}
		})
		this.initPromise = promise

		return this.initPromise
	}

	public updateOrbZone(orbRadius: number): void {
		if (!this.Matter || !this.bottomWall || this.height === 0) return
		const wallThickness = 50
		const newY =
			this.height - this.floorInset - (orbRadius * 2 + 20) + wallThickness / 2
		this.Matter.Body.setPosition(this.bottomWall, {
			x: this.width / 2,
			y: newY,
		})
	}

	/**
	 * Move every bubble back inside the walls after the field changed size, so a
	 * shorter field never leaves bubbles under the floor above the orb or past a
	 * side wall, where they would be stuck out of sight.
	 */
	public keepBubblesInside(): void {
		if (!this.Matter || !this.bottomWall) return
		// The floor's top edge: its centre less half the wall thickness (50).
		const floor = this.bottomWall.position.y - 25
		for (const { body, radius } of this.bubbleMap.values()) {
			const x = Math.min(Math.max(body.position.x, radius), this.width - radius)
			const y = Math.min(Math.max(body.position.y, radius), floor - radius)
			if (x !== body.position.x || y !== body.position.y) {
				this.Matter.Body.setPosition(body, { x, y })
				this.Matter.Body.setVelocity(body, { x: 0, y: 0 })
			}
		}
	}

	/**
	 * Add artist bodies to the simulation. Returns the number of artists that
	 * could not be added because the live-body ceiling was reached; callers
	 * SHOULD log a non-zero return rather than treat it as success. The cap
	 * counts only live (non-fading-out) bodies: bodies mid-fade-out are about to
	 * be removed and MUST NOT block new members, otherwise a background refresh
	 * that replaces the field silently shrinks it (real vs rendered divergence).
	 */
	public addBubbles(params: BubbleArtistParams[]): number {
		// Never create bodyless bubbles: if init has not run yet (Matter/world not
		// loaded — e.g. `attached()`/`artistsChanged` firing before the canvas has a
		// non-zero layout), skip. The canvas re-paints once `init()` completes.
		if (!this.Matter || !this.world) return 0
		let dropped = 0
		for (const { artist, radius, position } of params) {
			const id = artist.id
			if (!id || this.bubbleMap.has(id)) continue
			if (this.liveBubbleCount() >= MAX_BUBBLES) {
				// Hard safety ceiling. The field owner guarantees the target is within
				// capacity, so reaching this means an upstream cap failed — surface it
				// via the return value instead of silently dropping a target member.
				dropped++
				continue
			}

			const { x, y } = position ?? randomSpawnPoint(this.width, this.height)
			const body = this.Matter?.Bodies.circle(x, y, radius, {
				restitution: 0.6,
				friction: 0.1,
				frictionAir: 0.02,
				density: 0.001,
			})

			this.Matter?.Composite.add(this.world, body)
			// Instant appearance — ghost placeholders and cached re-entry bubbles
			// must paint immediately with no delay. The pop-in animation is reserved
			// for revealGhostBubbles (ghost→real swap) and spawnBubblesAt (tap flow).
			this.bubbleMap.set(id, {
				body,
				artist,
				radius,
				scale: 1,
				opacity: 1,
				isSpawning: false,
				spawnProgress: 1,
				isFadingOut: false,
				fadeOutProgress: 0,
			})
		}
		return dropped
	}

	/**
	 * Count bodies that are live (not fading out). This is the capacity-relevant
	 * count: fading-out bodies are transient and excluded so they do not block
	 * replacements during a field refresh.
	 */
	private liveBubbleCount(): number {
		let count = 0
		for (const bubble of this.bubbleMap.values()) {
			if (!bubble.isFadingOut) count++
		}
		return count
	}

	/**
	 * Reconcile the rendered bodies to match a target field: keep bodies whose
	 * artist is still in the target, fade out bodies no longer in it, and add
	 * bodies for new target artists (reusing ghost placeholders in-place when
	 * present for a smooth reveal). The physics layer applies NO policy —
	 * deduplication, followed-exclusion, and the 50-bubble cap are the field
	 * owner's responsibility; the target is assumed already within capacity.
	 * Returns the number of target artists dropped by the hard safety ceiling
	 * (0 in normal operation).
	 *
	 * `opts.placements` carries spawn-origin hints (from a tap top-up): a new
	 * target id present in the map is spawned FROM that point with the pop-outward
	 * animation instead of the instant random placement. This keeps a SINGLE path
	 * into physics (reconcile) with no ordering contract — the field owner sets
	 * the placements alongside the field, so the tap-origin animation is preserved
	 * without a separate `spawnBubblesAt` call racing the field reassignment.
	 *
	 * `opts.keepGhosts` is for a field that still holds ghost placeholders (a
	 * progressive cold-visit reveal): `target` lists only its real members, the
	 * new ones take ghost slots in place, and ghost bodies left without an artist
	 * are kept instead of faded out. Without it, leftover ghosts fade out.
	 */
	public reconcile(
		target: BubbleArtistParams[],
		opts?: {
			placements?: ReadonlyMap<string, { x: number; y: number }>
			keepGhosts?: boolean
		},
	): number {
		const paramsById = new Map<string, BubbleArtistParams>()
		for (const p of target) {
			if (p.artist.id) paramsById.set(p.artist.id, p)
		}

		// Reconcile existing bodies: revive a target member that is mid-fade (it was
		// removed then re-added within the ~300ms fade window, e.g. a genre toggle
		// A→B→A) so it is retained instead of silently disappearing when the fade
		// completes; fade out real bodies no longer in the target.
		for (const [id, bubble] of this.bubbleMap) {
			if (id.startsWith('__ghost__')) continue
			if (paramsById.has(id)) {
				if (bubble.isFadingOut) this.reviveBubble(id, bubble)
			} else if (!bubble.isFadingOut) {
				this.fadeOutBubble(id)
			}
		}

		// Reuse ghost placeholders in-place (smooth cold-visit reveal); returns
		// target artists that had no ghost slot and are not already rendered.
		const overflow = this.revealGhostBubbles(
			target.map((p) => p.artist),
			{ keepLeftover: opts?.keepGhosts ?? false },
		)

		const placements = opts?.placements
		const instantParams: BubbleArtistParams[] = []
		for (const artist of overflow) {
			const p = paramsById.get(artist.id)
			if (!p) continue
			const pos = placements?.get(artist.id)
			if (pos) {
				// Tap-origin add: pop outward from the tap point (spawn animation).
				this.spawnBubblesAt([p], pos.x, pos.y)
			} else {
				instantParams.push(p)
			}
		}
		return this.addBubbles(instantParams)
	}

	public spawnBubblesAt(
		params: BubbleArtistParams[],
		fromX: number,
		fromY: number,
	): void {
		// Skip if init has not run yet — never store a bodyless bubble (see addBubbles).
		if (!this.Matter || !this.world) return
		for (const { artist, radius } of params) {
			const id = artist.id
			if (!id || this.bubbleMap.has(id)) continue

			const body = this.Matter?.Bodies.circle(fromX, fromY, radius, {
				restitution: 0.6,
				friction: 0.1,
				frictionAir: 0.02,
				density: 0.001,
			})

			// Apply outward force for "pop" effect
			const angle = Math.random() * Math.PI * 2
			const force = 0.002 + Math.random() * 0.003
			this.Matter?.Body.applyForce(body, body.position, {
				x: Math.cos(angle) * force,
				y: Math.sin(angle) * force,
			})

			this.Matter?.Composite.add(this.world, body)
			this.bubbleMap.set(id, {
				body,
				artist,
				radius,
				scale: 0,
				opacity: 0,
				isSpawning: true,
				spawnProgress: 0,
				isFadingOut: false,
				fadeOutProgress: 0,
			})
		}
	}

	public removeBubble(artistId: string): PhysicsBubble | undefined {
		const bubble = this.bubbleMap.get(artistId)
		if (!bubble) return undefined

		this.Matter?.Composite.remove(this.world, bubble.body)
		this.bubbleMap.delete(artistId)
		return bubble
	}

	public fadeOutBubble(artistId: string): void {
		const bubble = this.bubbleMap.get(artistId)
		if (!bubble || bubble.isFadingOut) return
		bubble.isFadingOut = true
		bubble.fadeOutProgress = 0
	}

	/**
	 * Cancel an in-progress fade-out so a body that re-entered the target within
	 * the fade window is kept instead of being deleted by `update()` when the fade
	 * completes. Also releases the id from any pending `fadeOutBubbles` promise.
	 */
	private reviveBubble(artistId: string, bubble: PhysicsBubble): void {
		bubble.isFadingOut = false
		bubble.fadeOutProgress = 0
		bubble.opacity = 1
		if (
			this.fadeOutPendingIds.delete(artistId) &&
			this.fadeOutPendingIds.size === 0 &&
			this.fadeOutResolve
		) {
			this.fadeOutResolve()
			this.fadeOutResolve = null
		}
	}

	public fadeOutBubbles(artistIds: string[]): Promise<void> {
		if (artistIds.length === 0) return Promise.resolve()
		// Only track IDs that actually exist in the physics engine
		const validIds: string[] = []
		for (const id of artistIds) {
			if (this.bubbleMap.has(id)) {
				this.fadeOutBubble(id)
				validIds.push(id)
			}
		}
		if (validIds.length === 0) return Promise.resolve()
		return new Promise<void>((resolve) => {
			this.fadeOutResolve = resolve
			this.fadeOutPendingIds = new Set(validIds)
		})
	}

	public getBubbleAt(x: number, y: number): PhysicsBubble | undefined {
		return findClosestBubble(Array.from(this.bubbleMap.values()), x, y)
	}

	/**
	 * Advance one frame. `delta` steps the physics engine and should be capped
	 * by the caller so a long frame cannot make bodies explode. `animDelta` is
	 * the real elapsed time and drives the spawn and fade-out progress, so a
	 * revealed name becomes readable on real time at any frame rate.
	 */
	public update(delta: number, animDelta = delta): void {
		this.Matter?.Engine.update(this.engine, delta)

		const FADE_OUT_SPEED = 0.0033 // ~300ms to complete

		for (const bubble of this.bubbleMap.values()) {
			const id = bubble.artist.id
			if (bubble.isSpawning) {
				if (bubble.revealInPlace) {
					bubble.spawnProgress = Math.min(
						1,
						bubble.spawnProgress + animDelta * REVEAL_IN_PLACE_SPEED,
					)
					bubble.scale = 1
					bubble.opacity =
						GHOST_OPACITY + (1 - GHOST_OPACITY) * bubble.spawnProgress
				} else {
					bubble.spawnProgress = Math.min(
						1,
						bubble.spawnProgress + animDelta * 0.003,
					)
					bubble.scale = easeOutBack(bubble.spawnProgress)
					// Quadratic ease-in so color/text bleeds in gently during the second
					// half of the spawn rather than appearing abruptly with the circle.
					bubble.opacity = bubble.spawnProgress * bubble.spawnProgress
				}
				if (bubble.spawnProgress >= 1) {
					bubble.isSpawning = false
					bubble.revealInPlace = false
					bubble.scale = 1
					bubble.opacity = 1
				}
			} else if (bubble.isFadingOut) {
				bubble.fadeOutProgress = Math.min(
					1,
					bubble.fadeOutProgress + animDelta * FADE_OUT_SPEED,
				)
				bubble.opacity = 1 - bubble.fadeOutProgress
				if (bubble.fadeOutProgress >= 1) {
					this.Matter?.Composite.remove(this.world, bubble.body)
					this.bubbleMap.delete(id)
					this.fadeOutPendingIds.delete(id)
					if (this.fadeOutPendingIds.size === 0 && this.fadeOutResolve) {
						this.fadeOutResolve()
						this.fadeOutResolve = null
					}
				}
			}
		}
	}

	public getBubbles(): PhysicsBubble[] {
		return Array.from(this.bubbleMap.values())
	}

	public getBubbleEntries(): IterableIterator<[string, PhysicsBubble]> {
		return this.bubbleMap.entries()
	}

	public get bubbleCount(): number {
		return this.bubbleMap.size
	}

	/**
	 * Swap ghost placeholder bodies in-place for real artist data.
	 * The physics body (position, velocity, radius) is preserved so the bubble
	 * stays exactly where it is. Artists already rendered keep their own body.
	 * Returns new real artists that had no ghost to occupy. Ghost bodies left
	 * over fade out, unless `opts.keepLeftover` keeps them for later artists.
	 */
	public revealGhostBubbles(
		realArtists: Artist[],
		opts?: { keepLeftover?: boolean },
	): Artist[] {
		const ghostIds = Array.from(this.bubbleMap.entries())
			.filter(([id, b]) => id.startsWith('__ghost__') && !b.isFadingOut)
			.map(([id]) => id)
		const newArtists = realArtists.filter((a) => !this.bubbleMap.has(a.id))
		const overflow: Artist[] = []
		for (let i = 0; i < newArtists.length; i++) {
			const artist = newArtists[i]
			const ghostId = ghostIds[i]
			if (!ghostId) {
				overflow.push(artist)
				continue
			}
			const bubble = this.bubbleMap.get(ghostId)
			if (!bubble) continue
			this.bubbleMap.delete(ghostId)
			// Swap artist reference in place — physics position/velocity unchanged.
			// The bubble is already on screen, so it stays full size and fades up
			// from the ghost's opacity: the name shows within a few frames instead
			// of after a scale-from-zero pop.
			bubble.artist = artist
			bubble.isSpawning = true
			bubble.revealInPlace = true
			bubble.spawnProgress = 0
			bubble.scale = 1
			bubble.opacity = GHOST_OPACITY
			this.bubbleMap.set(artist.id, bubble)
		}
		// Fade out any ghost bodies left over (more ghosts than real artists).
		if (!opts?.keepLeftover) {
			for (let i = newArtists.length; i < ghostIds.length; i++) {
				this.fadeOutBubble(ghostIds[i])
			}
		}
		return overflow
	}

	public reset(): void {
		if (this.Matter && this.world) {
			this.Matter.Composite.clear(this.world, false)
		}
		this.bubbleMap.clear()
		this.walls = []
		this.initGeneration++
		this.initPromise = null
	}

	public destroy(): void {
		if (this.Matter && this.engine && this.world) {
			this.Matter.Engine.clear(this.engine)
			this.Matter.Composite.clear(this.world, false)
		}
		this.bubbleMap.clear()
		this.walls = []
		this.initPromise = null
	}
}

/**
 * Find the bubble whose center is closest to the given point,
 * among those whose hit radius contains the point.
 * Excludes ghost placeholders, fading-out bubbles and zero-scale bubbles.
 */
export function findClosestBubble(
	bubbles: readonly PhysicsBubble[],
	x: number,
	y: number,
): PhysicsBubble | undefined {
	let closest: PhysicsBubble | undefined
	let closestDist = Number.POSITIVE_INFINITY

	for (const bubble of bubbles) {
		if (bubble.isFadingOut || bubble.artist.isGhost) continue
		const hitRadius = bubble.radius * bubble.scale
		if (hitRadius <= 0) continue

		const pos = bubble.body.position
		const dx = pos.x - x
		const dy = pos.y - y
		const dist = Math.sqrt(dx * dx + dy * dy)
		if (dist <= hitRadius && dist < closestDist) {
			closest = bubble
			closestDist = dist
		}
	}
	return closest
}
