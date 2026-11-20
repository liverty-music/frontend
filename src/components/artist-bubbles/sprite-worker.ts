// Paints bubble sprites off the main thread into OffscreenCanvases and sends
// them back as ImageBitmaps (design D2 of `smooth-discovery-and-faster-start-up`).
import {
	measureWith,
	paintSprite,
	type SpriteRequest,
	spriteHalf,
	spritePixels,
} from './sprite-paint'

/** One painted sprite, sent back to the canvas. */
export interface SpriteResult {
	key: string
	gen: number
	/** Half the sprite's side in CSS px. */
	half: number
	bitmap: ImageBitmap
}

/** Results are sent in batches of this size, so the first names show early. */
export const SPRITE_BATCH = 4

let measure: ((text: string, font: string) => number) | null = null

/**
 * Paint every request and post the results `SPRITE_BATCH` at a time, the
 * bitmaps transferred. Throws when the 2D context is missing (an
 * OffscreenCanvas without 2D support): the error reaches the canvas as the
 * worker's `error` event, and the canvas paints on the main thread instead.
 */
export function paintSprites(
	requests: readonly SpriteRequest[],
	post: (results: SpriteResult[], transfer: Transferable[]) => void,
): void {
	if (!measure) {
		const ctx = new OffscreenCanvas(1, 1).getContext('2d')
		if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
		measure = measureWith(ctx)
	}
	let batch: SpriteResult[] = []
	const flush = () => {
		if (batch.length === 0) return
		post(
			batch,
			batch.map((r) => r.bitmap),
		)
		batch = []
	}
	for (const req of requests) {
		const px = spritePixels(req)
		const canvas = new OffscreenCanvas(px, px)
		const ctx = canvas.getContext('2d')
		if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable')
		paintSprite(ctx, req, measure)
		batch.push({
			key: req.key,
			gen: req.gen,
			half: spriteHalf(req.kind, req.radius),
			bitmap: canvas.transferToImageBitmap(),
		})
		if (batch.length >= SPRITE_BATCH) flush()
	}
	flush()
}

/** Test seam: forget the measuring context. */
export function resetSpriteWorkerForTests(): void {
	measure = null
}

// Installed only when this module runs as a worker (it has no `document`).
if (typeof document === 'undefined' && typeof self !== 'undefined') {
	const scope = self as unknown as {
		onmessage: ((e: MessageEvent<SpriteRequest[]>) => void) | null
		postMessage: (message: unknown, transfer: Transferable[]) => void
	}
	scope.onmessage = (e) => {
		paintSprites(e.data, (results, transfer) =>
			scope.postMessage(results, transfer),
		)
	}
}
