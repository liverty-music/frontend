/// <reference lib="webworker" />
/**
 * TEMPORARY SPIKE (task 0.4): decodes camera frames with @paulmillr/qr off the
 * main thread. Receives {id, width, height, data: RGBA}; answers {id, text}
 * with text null when no QR code was found.
 */
import { decodeQR } from '@paulmillr/qr/decode.js'

interface FrameMessage {
	readonly id: number
	readonly width: number
	readonly height: number
	readonly data: Uint8ClampedArray
}

self.onmessage = (event: MessageEvent<FrameMessage>) => {
	const { id, width, height, data } = event.data
	let text: string | null = null
	try {
		text = decodeQR({ width, height, data })
	} catch {
		text = null
	}
	;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, text })
}
