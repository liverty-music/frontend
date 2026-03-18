import type Matter from 'matter-js'
import type { Artist } from '../../entities/artist'

/** A physics-enabled bubble wrapping a proto Artist with position and radius. */
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
			const orbZoneHeight = 160
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

	public addBubbles(params: BubbleArtistParams[]): void {
		for (const { artist, radius } of params) {
			const id = artist.id?.value ?? ''
			if (!id || this.bubbleMap.has(id)) continue

			const x = Math.random() * (this.width - 100) + 50
			const y = Math.random() * (this.height * 0.5) + 50
			const body = this.Matter?.Bodies.circle(x, y, radius, {
				restitution: 0.6,
				friction: 0.1,
				frictionAir: 0.02,
				density: 0.001,
			})

			this.Matter?.Composite.add(this.world, body)
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
	}

	public spawnBubblesAt(
		params: BubbleArtistParams[],
		fromX: number,
		fromY: number,
	): void {
		for (const { artist, radius } of params) {
			const id = artist.id?.value ?? ''
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
		for (const bubble of this.bubbleMap.values()) {
			if (bubble.isFadingOut) continue
			const pos = bubble.body.position
			const dx = pos.x - x
			const dy = pos.y - y
			const dist = Math.sqrt(dx * dx + dy * dy)
			if (dist <= bubble.radius * bubble.scale) {
				return bubble
			}
		}
		return undefined
	}

	public update(delta: number): void {
		this.Matter?.Engine.update(this.engine, delta)

		const FADE_OUT_SPEED = 0.0033 // ~300ms to complete

		for (const bubble of this.bubbleMap.values()) {
			const id = bubble.artist.id?.value ?? ''
			if (bubble.isSpawning) {
				bubble.spawnProgress = Math.min(1, bubble.spawnProgress + delta * 0.004)
				bubble.scale = easeOutBack(bubble.spawnProgress)
				bubble.opacity = bubble.spawnProgress
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

	public get bubbleCount(): number {
		return this.bubbleMap.size
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

function easeOutBack(t: number): number {
	const c1 = 1.70158
	const c3 = c1 + 1
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}
