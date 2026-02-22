import type Matter from 'matter-js'
import type { ArtistBubble } from '../../services/artist-discovery-service'

export interface PhysicsBubble {
	body: Matter.Body
	artist: ArtistBubble
	scale: number
	opacity: number
	isSpawning: boolean
	spawnProgress: number
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

	public async init(width: number, height: number): Promise<void> {
		if (this.initPromise) return this.initPromise

		const gen = ++this.initGeneration
		this.initPromise = (async () => {
			// Lazy-load Matter.js on first init call
			if (!this.Matter) {
				this.Matter = (await import('matter-js')).default
				this.engine = this.Matter?.Engine.create({
					gravity: { x: 0, y: 0.15, scale: 0.001 },
				})
				this.world = this.engine.world
			}

			this.width = width
			this.height = height

			for (const wall of this.walls) {
				this.Matter?.Composite.remove(this.world, wall)
			}
			this.walls = []

			const wallThickness = 50
			const orbZoneHeight = 160
			this.walls = [
				// Top
				this.Matter?.Bodies.rectangle(
					width / 2,
					-wallThickness / 2,
					width,
					wallThickness,
					{ isStatic: true },
				),
				// Left
				this.Matter?.Bodies.rectangle(
					-wallThickness / 2,
					height / 2,
					wallThickness,
					height,
					{ isStatic: true },
				),
				// Right
				this.Matter?.Bodies.rectangle(
					width + wallThickness / 2,
					height / 2,
					wallThickness,
					height,
					{ isStatic: true },
				),
				// Bottom (above orb zone)
				this.Matter?.Bodies.rectangle(
					width / 2,
					height - orbZoneHeight + wallThickness / 2,
					width,
					wallThickness,
					{ isStatic: true },
				),
			]
			if (gen !== this.initGeneration) return
			this.Matter?.Composite.add(this.world, this.walls)
		})().finally(() => {
			this.initPromise = null
		})

		return this.initPromise
	}

	public addBubbles(artists: ArtistBubble[]): void {
		for (const artist of artists) {
			if (this.bubbleMap.has(artist.id)) continue

			const x = Math.random() * (this.width - 100) + 50
			const y = Math.random() * (this.height * 0.5) + 50
			const body = this.Matter?.Bodies.circle(x, y, artist.radius, {
				restitution: 0.6,
				friction: 0.1,
				frictionAir: 0.02,
				density: 0.001,
			})

			this.Matter?.Composite.add(this.world, body)
			this.bubbleMap.set(artist.id, {
				body,
				artist,
				scale: 1,
				opacity: 1,
				isSpawning: false,
				spawnProgress: 1,
			})
		}
	}

	public spawnBubblesAt(
		artists: ArtistBubble[],
		fromX: number,
		fromY: number,
	): void {
		for (const artist of artists) {
			if (this.bubbleMap.has(artist.id)) continue

			const body = this.Matter?.Bodies.circle(
				fromX,
				fromY,
				artist.radius,
				{
					restitution: 0.6,
					friction: 0.1,
					frictionAir: 0.02,
					density: 0.001,
				},
			)

			// Apply outward force for "pop" effect
			const angle = Math.random() * Math.PI * 2
			const force = 0.002 + Math.random() * 0.003
			this.Matter?.Body.applyForce(body, body.position, {
				x: Math.cos(angle) * force,
				y: Math.sin(angle) * force,
			})

			this.Matter?.Composite.add(this.world, body)
			this.bubbleMap.set(artist.id, {
				body,
				artist,
				scale: 0,
				opacity: 0,
				isSpawning: true,
				spawnProgress: 0,
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

	public getBubbleAt(x: number, y: number): PhysicsBubble | undefined {
		for (const bubble of this.bubbleMap.values()) {
			const pos = bubble.body.position
			const dx = pos.x - x
			const dy = pos.y - y
			const dist = Math.sqrt(dx * dx + dy * dy)
			if (dist <= bubble.artist.radius * bubble.scale) {
				return bubble
			}
		}
		return undefined
	}

	public update(delta: number): void {
		this.Matter?.Engine.update(this.engine, delta)

		for (const bubble of this.bubbleMap.values()) {
			if (bubble.isSpawning) {
				bubble.spawnProgress = Math.min(
					1,
					bubble.spawnProgress + delta * 0.004,
				)
				bubble.scale = easeOutBack(bubble.spawnProgress)
				bubble.opacity = bubble.spawnProgress
				if (bubble.spawnProgress >= 1) {
					bubble.isSpawning = false
					bubble.scale = 1
					bubble.opacity = 1
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
		this.Matter?.Composite.clear(this.world, false)
		this.bubbleMap.clear()
		this.walls = []
		this.initGeneration++
		this.initPromise = null
	}

	public destroy(): void {
		this.Matter?.Engine.clear(this.engine)
		this.Matter?.Composite.clear(this.world, false)
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
