import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpriteRequest } from './sprite-paint'
import {
	paintSprites,
	resetSpriteWorkerForTests,
	SPRITE_BATCH,
	type SpriteResult,
} from './sprite-worker'

/** A stub of the 2D context the sprite painter touches. */
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

let created: {
	width: number
	height: number
	ctx: ReturnType<typeof stubContext>
}[]
let has2d: boolean

class StubOffscreenCanvas {
	public readonly ctx = stubContext()
	constructor(
		public width: number,
		public height: number,
	) {
		created.push(this)
	}
	getContext(kind: string) {
		return kind === '2d' && has2d ? this.ctx : null
	}
	transferToImageBitmap() {
		return { width: this.width, close: vi.fn() } as unknown as ImageBitmap
	}
}

function request(i: number, over: Partial<SpriteRequest> = {}): SpriteRequest {
	return {
		key: `label|40|A${i}`,
		kind: 'label',
		name: `Artist ${i}`,
		radius: 40,
		hue: 0,
		dpr: 2,
		gen: 3,
		...over,
	}
}

describe('sprite worker message contract', () => {
	beforeEach(() => {
		created = []
		has2d = true
		resetSpriteWorkerForTests()
		vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('answers every request, in batches of 4, with the key, generation, half side and a transferred bitmap', () => {
		const posts: { results: SpriteResult[]; transfer: Transferable[] }[] = []
		const requests = Array.from({ length: 10 }, (_, i) => request(i))

		paintSprites(requests, (results, transfer) =>
			posts.push({ results, transfer }),
		)

		expect(SPRITE_BATCH).toBe(4)
		expect(posts.map((p) => p.results.length)).toEqual([4, 4, 2])
		const results = posts.flatMap((p) => p.results)
		expect(results.map((r) => r.key)).toEqual(requests.map((r) => r.key))
		expect(results.every((r) => r.gen === 3 && r.half === 40)).toBe(true)
		for (const p of posts) {
			expect(p.transfer).toEqual(p.results.map((r) => r.bitmap))
		}
	})

	it('sizes a body sprite to hold the rim blur, and a label sprite to the circle, at the device pixel ratio', () => {
		paintSprites(
			[request(0, { kind: 'body', key: 'body|40|200', hue: 200 }), request(1)],
			() => {},
		)

		// created[0] is the 1×1 measuring canvas.
		expect(created.slice(1).map((c) => c.width)).toEqual([
			Math.ceil(40 * 1.6 * 2 * 2),
			40 * 2 * 2,
		])
		const label = created[2].ctx
		expect(label.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 80, 80)
		expect(label.fillText).toHaveBeenCalledWith('Artist 1', 0, 0, 64)
	})

	it('throws when OffscreenCanvas has no 2D context, so the canvas falls back to the main thread', () => {
		has2d = false

		expect(() => paintSprites([request(0)], () => {})).toThrow(/2D context/)
	})
})
