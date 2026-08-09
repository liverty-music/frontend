import type Matter from 'matter-js'
import type { Artist } from '../../entities/artist'
import { BubblePool } from '../../services/bubble-pool'
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
	isFadingOut: boolean
	fadeOutProgress: number
}

/** Parameters for adding an artist to the physics simulation. */
export interface BubbleArtistParams {
	artist: Artist
	radius: number
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

	public async init(width: number, height: number): Promise<void> {
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
				this.Matter = (await import('matter-js')).default
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
				h - orbZoneHeight + wallThickness / 2,
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
		const newY = this.height - (orbRadius * 2 + 20) + wallThickness / 2
		this.Matter.Body.setPosition(this.bottomWall, {
			x: this.width / 2,
			y: newY,
		})
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
		let dropped = 0
		for (const { artist, radius } of params) {
			const id = artist.id
			if (!id || this.bubbleMap.has(id)) continue
			if (this.liveBubbleCount() >= BubblePool.MAX_BUBBLES) {
				// Hard safety ceiling. The field owner guarantees the target is within
				// capacity, so reaching this means an upstream cap failed — surface it
				// via the return value instead of silently dropping a target member.
				dropped++
				continue
			}

			const x = Math.random() * (this.width - 100) + 50
			const y = Math.random() * (this.height * 0.5) + 50
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
	 */
	public reconcile(target: BubbleArtistParams[]): number {
		const paramsById = new Map<string, BubbleArtistParams>()
		for (const p of target) {
			if (p.artist.id) paramsById.set(p.artist.id, p)
		}

		// Fade out real (non-ghost) bodies that are no longer in the target.
		for (const [id, bubble] of this.bubbleMap) {
			if (id.startsWith('__ghost__')) continue
			if (bubble.isFadingOut) continue
			if (!paramsById.has(id)) this.fadeOutBubble(id)
		}

		// Reuse ghost placeholders in-place (smooth cold-visit reveal); returns
		// target artists that had no ghost slot and are not already rendered.
		const overflow = this.revealGhostBubbles(target.map((p) => p.artist))

		const overflowParams: BubbleArtistParams[] = []
		for (const artist of overflow) {
			const p = paramsById.get(artist.id)
			if (p) overflowParams.push(p)
		}
		return this.addBubbles(overflowParams)
	}

	public spawnBubblesAt(
		params: BubbleArtistParams[],
		fromX: number,
		fromY: number,
	): void {
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

	public update(delta: number): void {
		this.Matter?.Engine.update(this.engine, delta)

		const FADE_OUT_SPEED = 0.0033 // ~300ms to complete

		for (const bubble of this.bubbleMap.values()) {
			const id = bubble.artist.id
			if (bubble.isSpawning) {
				bubble.spawnProgress = Math.min(1, bubble.spawnProgress + delta * 0.003)
				bubble.scale = easeOutBack(bubble.spawnProgress)
				// Quadratic ease-in so color/text bleeds in gently during the second
				// half of the spawn rather than appearing abruptly with the circle.
				bubble.opacity = bubble.spawnProgress * bubble.spawnProgress
				if (bubble.spawnProgress >= 1) {
					bubble.isSpawning = false
					bubble.scale = 1
					bubble.opacity = 1
				}
			} else if (bubble.isFadingOut) {
				bubble.fadeOutProgress = Math.min(
					1,
					bubble.fadeOutProgress + delta * FADE_OUT_SPEED,
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
	 * stays exactly where it is. Returns real artists that had no ghost to occupy.
	 */
	public revealGhostBubbles(realArtists: Artist[]): Artist[] {
		const ghostIds = Array.from(this.bubbleMap.keys()).filter((id) =>
			id.startsWith('__ghost__'),
		)
		const overflow: Artist[] = []
		for (let i = 0; i < realArtists.length; i++) {
			const artist = realArtists[i]
			const ghostId = ghostIds[i]
			if (!ghostId) {
				overflow.push(artist)
				continue
			}
			const bubble = this.bubbleMap.get(ghostId)
			if (!bubble) continue
			this.bubbleMap.delete(ghostId)
			// Swap artist reference in place — physics position/velocity unchanged.
			// Restart the spawn animation so the real artist appears with the same
			// scale-from-zero + easeOutBack bounce as any other new bubble.
			bubble.artist = artist
			bubble.isSpawning = true
			bubble.spawnProgress = 0
			bubble.scale = 0
			bubble.opacity = 0
			this.bubbleMap.set(artist.id, bubble)
		}
		// Fade out any ghost bodies left over (more ghosts than real artists).
		for (let i = realArtists.length; i < ghostIds.length; i++) {
			this.fadeOutBubble(ghostIds[i])
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
 * Excludes fading-out bubbles and zero-scale bubbles.
 */
export function findClosestBubble(
	bubbles: readonly PhysicsBubble[],
	x: number,
	y: number,
): PhysicsBubble | undefined {
	let closest: PhysicsBubble | undefined
	let closestDist = Number.POSITIVE_INFINITY

	for (const bubble of bubbles) {
		if (bubble.isFadingOut) continue
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
