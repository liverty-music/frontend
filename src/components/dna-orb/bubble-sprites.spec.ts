import { describe, expect, it, vi } from 'vitest'
import {
	BubbleSprites,
	MAIN_THREAD_SPRITES_PER_FRAME,
	SPRITE_CACHE_LIMIT,
	type SpritePainters,
} from './bubble-sprites'
import type { SpriteRequest } from './sprite-paint'
import type { SpriteResult } from './sprite-worker'

/** A worker double: records posted batches, answers when the test says so. */
class FakeWorker {
	public posted: SpriteRequest[][] = []
	public onmessage: ((e: MessageEvent<SpriteResult[]>) => void) | null = null
	public onerror: ((e: Event) => void) | null = null
	public onmessageerror: ((e: MessageEvent) => void) | null = null
	public readonly terminate = vi.fn()

	postMessage(batch: SpriteRequest[]): void {
		this.posted.push(batch)
	}

	/** Answer `requests` as the real worker would. */
	answer(requests: SpriteRequest[]): ReturnType<typeof bitmap>[] {
		const bitmaps = requests.map(() => bitmap())
		this.onmessage?.({
			data: requests.map((r, i) => ({
				key: r.key,
				gen: r.gen,
				half: r.radius,
				bitmap: bitmaps[i] as unknown as ImageBitmap,
			})),
		} as MessageEvent<SpriteResult[]>)
		return bitmaps
	}

	fail(): void {
		this.onerror?.(new Event('error'))
	}
}

function bitmap() {
	return { close: vi.fn() }
}

function stubContext() {
	return {
		setTransform: vi.fn(),
		createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
		stroke: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		fillText: vi.fn(),
		measureText: vi.fn((t: string) => ({ width: [...t].length * 8 })),
		font: '',
	}
}

function painters(worker: FakeWorker | null): SpritePainters & {
	canvases: { width: number; ctx: ReturnType<typeof stubContext> }[]
} {
	const canvases: { width: number; ctx: ReturnType<typeof stubContext> }[] = []
	return {
		canvases,
		createWorker: () => worker as unknown as Worker | null,
		createCanvas: (px) => {
			const c = { width: px, ctx: stubContext() }
			canvases.push(c)
			return {
				width: px,
				height: px,
				getContext: () => c.ctx,
			} as unknown as HTMLCanvasElement
		},
	}
}

describe('BubbleSprites with a worker', () => {
	it('returns null until the worker paints a sprite, then the sprite', () => {
		const worker = new FakeWorker()
		const sut = new BubbleSprites(painters(worker))
		sut.start()

		expect(sut.label('YOASOBI', 40)).toBeNull()
		expect(sut.body(40, 200)).toBeNull()
		sut.flush()

		expect(sut.offMainThread).toBe(true)
		expect(worker.posted).toHaveLength(1)
		expect(worker.posted[0].map((r) => r.kind)).toEqual(['label', 'body'])
		worker.answer(worker.posted[0])
		expect(sut.label('YOASOBI', 40)).toMatchObject({ half: 40 })
		expect(sut.body(40, 200)).not.toBeNull()
	})

	it('asks for each sprite once while it is being painted', () => {
		const worker = new FakeWorker()
		const sut = new BubbleSprites(painters(worker))
		sut.start()

		sut.label('A', 40)
		sut.flush()
		sut.label('A', 40)
		sut.label('A', 40)
		sut.flush()

		expect(worker.posted).toHaveLength(1)
	})

	it('closes the bitmaps when the cache is cleared, and discards results of an earlier cache', () => {
		const worker = new FakeWorker()
		const sut = new BubbleSprites(painters(worker))
		sut.start()
		sut.label('A', 40)
		sut.flush()
		const [kept] = worker.answer(worker.posted[0])
		sut.label('B', 40)
		sut.flush()

		// A device-pixel-ratio change clears the cache.
		sut.setDpr(2)
		expect(kept.close).toHaveBeenCalledOnce()
		expect(sut.label('A', 40)).toBeNull()
		// B's answer was painted for the old cache: it is closed, not stored.
		const [late] = worker.answer(worker.posted[1])
		expect(late.close).toHaveBeenCalledOnce()
		expect(sut.label('B', 40)).toBeNull()
	})

	it(`clears the cache above ${SPRITE_CACHE_LIMIT} sprites`, () => {
		const worker = new FakeWorker()
		const sut = new BubbleSprites(painters(worker))
		sut.start()
		for (let i = 0; i < SPRITE_CACHE_LIMIT; i++) sut.label(`n${i}`, 40)
		sut.flush()
		const bitmaps = worker.answer(worker.posted[0])

		sut.label('one more', 40)
		sut.flush()
		worker.answer(worker.posted[1])

		expect(bitmaps.every((b) => b.close.mock.calls.length === 1)).toBe(true)
		expect(sut.label('n0', 40)).toBeNull()
		expect(sut.label('one more', 40)).not.toBeNull()
	})

	it('terminates the worker and closes every bitmap on stop', () => {
		const worker = new FakeWorker()
		const sut = new BubbleSprites(painters(worker))
		sut.start()
		sut.label('A', 40)
		sut.flush()
		const [b] = worker.answer(worker.posted[0])

		sut.stop()

		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(b.close).toHaveBeenCalledOnce()
		expect(sut.offMainThread).toBe(false)
	})

	it('paints on the main thread for the rest of the visit once the worker fails, including what it was painting', () => {
		const worker = new FakeWorker()
		const p = painters(worker)
		const sut = new BubbleSprites(p)
		sut.start()
		sut.label('A', 40)
		sut.flush()

		worker.fail()
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(sut.offMainThread).toBe(false)
		sut.flush()

		expect(sut.label('A', 40)).not.toBeNull()
		sut.start()
		expect(sut.offMainThread).toBe(false)
	})
})

describe('BubbleSprites without a worker', () => {
	it(`paints at most ${MAIN_THREAD_SPRITES_PER_FRAME} sprites per frame on the main thread`, () => {
		const p = painters(null)
		const sut = new BubbleSprites(p)
		sut.start()
		for (let i = 0; i < 10; i++) sut.label(`n${i}`, 40)

		sut.flush()
		const painted = () =>
			Array.from({ length: 10 }, (_, i) => sut.label(`n${i}`, 40)).filter(
				Boolean,
			).length

		expect(sut.offMainThread).toBe(false)
		expect(painted()).toBe(4)
		sut.flush()
		expect(painted()).toBe(8)
		sut.flush()
		expect(painted()).toBe(10)
	})

	it('paints the same label the worker would: the name centered in a canvas the size of the circle', () => {
		const p = painters(null)
		const sut = new BubbleSprites(p)
		sut.setDpr(2)
		sut.label('Ado', 40)

		sut.flush()

		const sprite = p.canvases.find((c) => c.width === 160)
		expect(sprite?.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 80, 80)
		expect(sprite?.ctx.fillText).toHaveBeenCalledWith('Ado', 0, 0, 64)
	})
})
