/**
 * The one decoder interface the reception screen scans through. The
 * implementation is chosen once per scanning session:
 *
 * - `BarcodeDetector` (Shape Detection API) when the browser has it and it
 *   supports `qr_code` — Chrome on Android;
 * - otherwise ZXing compiled to WebAssembly, run in a Web Worker so decoding
 *   stays off the main thread — Safari on iOS, Firefox.
 *
 * The screen never knows which one it got, so the choice can change without
 * touching it.
 */
export interface QrDecoder {
	/** Which implementation this is (for logs and measurements only). */
	readonly kind: 'barcode-detector' | 'zxing-wasm'
	/** The texts of the QR codes found in one camera frame; empty when none. */
	decode(frame: ImageData): Promise<string[]>
	/** Release the decoder's resources (the worker). */
	close(): void
}

/** The subset of the Shape Detection API's BarcodeDetector used here. */
export interface BarcodeDetectorLike {
	detect(source: ImageData): Promise<readonly { rawValue: string }[]>
}

export interface BarcodeDetectorConstructor {
	new (options: { formats: string[] }): BarcodeDetectorLike
	getSupportedFormats(): Promise<readonly string[]>
}

/** The subset of `Worker` the ZXing decoder talks to. */
export interface WorkerLike {
	postMessage(message: unknown, transfer: Transferable[]): void
	addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
	addEventListener(type: 'error', listener: (e: Event) => void): void
	terminate(): void
}

/** Request and reply between {@link ZxingWorkerDecoder} and its worker. */
export interface DecodeRequest {
	readonly id: number
	readonly width: number
	readonly height: number
	readonly data: Uint8ClampedArray<ArrayBuffer>
}

export type DecodeReply =
	| { readonly id: number; readonly texts: string[] }
	| { readonly id: number; readonly error: string }

/** {@link QrDecoder} over the browser's own `BarcodeDetector`. */
export class BarcodeDetectorDecoder implements QrDecoder {
	public readonly kind = 'barcode-detector'

	constructor(private readonly detector: BarcodeDetectorLike) {}

	public async decode(frame: ImageData): Promise<string[]> {
		const found = await this.detector.detect(frame)
		return found.map((b) => b.rawValue).filter((t) => t.length > 0)
	}

	public close(): void {}
}

/** {@link QrDecoder} over ZXing WebAssembly running in a Web Worker. */
export class ZxingWorkerDecoder implements QrDecoder {
	public readonly kind = 'zxing-wasm'
	private nextId = 1
	private readonly pending = new Map<
		number,
		{ resolve: (texts: string[]) => void; reject: (err: Error) => void }
	>()

	constructor(private readonly worker: WorkerLike) {
		worker.addEventListener('message', (e: MessageEvent) => {
			const reply = e.data as DecodeReply
			const waiter = this.pending.get(reply.id)
			if (!waiter) return
			this.pending.delete(reply.id)
			if ('error' in reply) waiter.reject(new Error(reply.error))
			else waiter.resolve(reply.texts)
		})
		worker.addEventListener('error', () => {
			this.failAll(new Error('QR decoder worker failed'))
		})
	}

	public decode(frame: ImageData): Promise<string[]> {
		const id = this.nextId++
		// Copy into a buffer of our own so it can be transferred, not cloned.
		const data = new Uint8ClampedArray(frame.data)
		const request: DecodeRequest = {
			id,
			width: frame.width,
			height: frame.height,
			data,
		}
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject })
			this.worker.postMessage(request, [data.buffer])
		})
	}

	public close(): void {
		this.worker.terminate()
		this.failAll(new Error('QR decoder closed'))
	}

	private failAll(err: Error): void {
		for (const waiter of this.pending.values()) waiter.reject(err)
		this.pending.clear()
	}
}

export interface DecoderEnvironment {
	readonly barcodeDetector: BarcodeDetectorConstructor | undefined
	readonly createWorker: () => WorkerLike
}

/** The browser's environment: its BarcodeDetector, and the ZXing worker. */
export function browserDecoderEnvironment(): DecoderEnvironment {
	const g = globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }
	return {
		barcodeDetector: g.BarcodeDetector,
		createWorker: () =>
			new Worker(new URL('./zxing.worker.ts', import.meta.url), {
				type: 'module',
			}),
	}
}

/**
 * Picks the decoder: `BarcodeDetector` when it supports `qr_code`, otherwise
 * the ZXing worker. A BarcodeDetector that throws while being asked counts as
 * absent.
 */
export async function createQrDecoder(
	env: DecoderEnvironment = browserDecoderEnvironment(),
): Promise<QrDecoder> {
	const Detector = env.barcodeDetector
	if (Detector) {
		try {
			const formats = await Detector.getSupportedFormats()
			if (formats.includes('qr_code')) {
				return new BarcodeDetectorDecoder(
					new Detector({ formats: ['qr_code'] }),
				)
			}
		} catch {
			// Fall through to ZXing.
		}
	}
	return new ZxingWorkerDecoder(env.createWorker())
}
