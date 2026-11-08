import {
	measureWith,
	paintSprite,
	type SpriteKind,
	type SpriteRequest,
	spriteHalf,
	spriteKey,
	spritePixels,
} from './sprite-paint'
import type { SpriteResult } from './sprite-worker'

/** A painted bubble part, pasted every frame with `drawImage`. */
export interface Sprite {
	image: CanvasImageSource
	/** Half the sprite's side in CSS px. */
	half: number
}

/** Above this many sprites the cache is cleared (a long session of taps). */
export const SPRITE_CACHE_LIMIT = 400
/** Sprites painted per frame on the main thread, when there is no worker. */
export const MAIN_THREAD_SPRITES_PER_FRAME = 4

/** How the sprites are painted: hooks replaced by tests. */
export interface SpritePainters {
	/**
	 * Start the sprite worker; null where OffscreenCanvas or module workers
	 * are missing, so sprites are painted on the main thread.
	 */
	createWorker: () => Worker | null
	/** A page canvas of `px` × `px` device pixels, for main-thread sprites. */
	createCanvas: (px: number) => HTMLCanvasElement
}

const defaultPainters: SpritePainters = {
	createWorker: () => {
		if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function')
			return null
		return new Worker(new URL('./sprite-worker.ts', import.meta.url), {
			type: 'module',
		})
	},
	createCanvas: (px) => {
		const canvas = document.createElement('canvas')
		canvas.width = px
		canvas.height = px
		return canvas
	},
}

/**
 * The bubble sprites of one canvas: a cache keyed by look and full radius, and
 * the painter that fills it. Sprites are painted in a Web Worker when the
 * browser has one with OffscreenCanvas 2D; otherwise, or once the worker
 * fails, on the main thread, a few per frame. A lookup never waits: a missing
 * sprite is requested and the caller draws without it this frame.
 */
export class BubbleSprites {
	private readonly cache = new Map<string, Sprite>()
	// Requested and not yet sent to a painter.
	private readonly pending = new Map<string, SpriteRequest>()
	// Sent to the worker, not yet answered.
	private readonly inFlight = new Map<string, SpriteRequest>()
	private worker: Worker | null = null
	private workerFailed = false
	private gen = 0
	private dpr = 1
	private measure: ((text: string, font: string) => number) | null = null

	constructor(private readonly painters: SpritePainters = defaultPainters) {}

	/** Whether sprites are being painted off the main thread. */
	public get offMainThread(): boolean {
		return this.worker !== null
	}

	/** Start the worker, so its module loads before the first request. */
	public start(): void {
		if (this.worker || this.workerFailed) return
		let worker: Worker | null = null
		try {
			worker = this.painters.createWorker()
		} catch {
			worker = null
		}
		if (!worker) {
			this.workerFailed = true
			return
		}
		worker.onmessage = (e: MessageEvent<SpriteResult[]>) => this.receive(e.data)
		worker.onerror = () => this.failWorker()
		worker.onmessageerror = () => this.failWorker()
		this.worker = worker
	}

	/** Stop the worker and release every sprite. */
	public stop(): void {
		this.worker?.terminate()
		this.worker = null
		this.clear()
	}

	/** Paint at `dpr` from now on; a change drops the sprites painted before. */
	public setDpr(dpr: number): void {
		if (dpr === this.dpr) return
		this.dpr = dpr
		this.clear()
	}

	/** An artist bubble's body (gradient and rim), or null until painted. */
	public body(radius: number, hue: number): Sprite | null {
		return this.lookup('body', radius, hue, '', hue)
	}

	/** A ghost placeholder's body, or null until painted. */
	public ghost(radius: number): Sprite | null {
		return this.lookup('ghost', radius, '', '', 0)
	}

	/** An artist name laid out for `radius`, or null until painted. */
	public label(name: string, radius: number): Sprite | null {
		return this.lookup('label', radius, name, name, 0)
	}

	/**
	 * Send the requests of this frame: all of them to the worker, or at most
	 * `MAIN_THREAD_SPRITES_PER_FRAME` painted here.
	 */
	public flush(): void {
		if (this.pending.size === 0) return
		if (this.worker) {
			const batch = [...this.pending.values()]
			this.pending.clear()
			for (const r of batch) this.inFlight.set(r.key, r)
			this.worker.postMessage(batch)
			return
		}
		let painted = 0
		for (const [key, req] of this.pending) {
			if (painted >= MAIN_THREAD_SPRITES_PER_FRAME) break
			this.pending.delete(key)
			painted++
			const sprite = this.paintHere(req)
			if (sprite) this.store(key, sprite)
		}
	}

	/** Drop every sprite and request; in-flight results are discarded. */
	public clear(): void {
		for (const s of this.cache.values()) closeImage(s.image)
		this.cache.clear()
		this.pending.clear()
		this.inFlight.clear()
		this.gen++
	}

	private lookup(
		kind: SpriteKind,
		radius: number,
		keyPart: string | number,
		name: string,
		hue: number,
	): Sprite | null {
		const key = spriteKey(kind, radius, keyPart)
		const hit = this.cache.get(key)
		if (hit) return hit
		if (!this.pending.has(key) && !this.inFlight.has(key)) {
			this.pending.set(key, {
				key,
				kind,
				name,
				radius,
				hue,
				dpr: this.dpr,
				gen: this.gen,
			})
		}
		return null
	}

	private receive(results: SpriteResult[]): void {
		for (const r of results) {
			if (r.gen !== this.gen || !this.inFlight.delete(r.key)) {
				r.bitmap.close()
				continue
			}
			this.store(r.key, { image: r.bitmap, half: r.half })
		}
	}

	private store(key: string, sprite: Sprite): void {
		if (this.cache.size >= SPRITE_CACHE_LIMIT) {
			for (const s of this.cache.values()) closeImage(s.image)
			this.cache.clear()
		}
		this.cache.set(key, sprite)
	}

	/** The worker failed: paint the rest of this visit on the main thread. */
	private failWorker(): void {
		this.worker?.terminate()
		this.worker = null
		this.workerFailed = true
		for (const [key, req] of this.inFlight) this.pending.set(key, req)
		this.inFlight.clear()
	}

	private paintHere(req: SpriteRequest): Sprite | null {
		const canvas = this.painters.createCanvas(spritePixels(req))
		const ctx = canvas.getContext('2d')
		if (!ctx) return null
		if (!this.measure) {
			const m = this.painters.createCanvas(1).getContext('2d')
			if (!m) return null
			this.measure = measureWith(m)
		}
		paintSprite(ctx, req, this.measure)
		return { image: canvas, half: spriteHalf(req.kind, req.radius) }
	}
}

/** Release an ImageBitmap's memory now; a page canvas has nothing to close. */
function closeImage(image: CanvasImageSource): void {
	const bitmap = image as Partial<ImageBitmap>
	if (typeof bitmap.close === 'function') bitmap.close()
}
