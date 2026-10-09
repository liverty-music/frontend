import { describe, expect, it, vi } from 'vitest'
import {
	type BarcodeDetectorConstructor,
	createQrDecoder,
	type DecodeReply,
	type DecodeRequest,
	type WorkerLike,
} from '../../../../reception/reception-route/decoder/qr-decoder'

function frame(width = 4, height = 2): ImageData {
	return {
		width,
		height,
		data: new Uint8ClampedArray(width * height * 4).fill(7),
		colorSpace: 'srgb',
	} as ImageData
}

/** A worker double that answers each request through `reply`. */
class FakeWorker implements WorkerLike {
	public requests: { message: DecodeRequest; transfer: Transferable[] }[] = []
	public terminated = false
	private onMessage: ((e: MessageEvent) => void) | null = null
	private onError: ((e: Event) => void) | null = null

	public postMessage(message: unknown, transfer: Transferable[]): void {
		this.requests.push({ message: message as DecodeRequest, transfer })
	}

	public addEventListener(
		type: 'message' | 'error',
		listener: ((e: MessageEvent) => void) | ((e: Event) => void),
	): void {
		if (type === 'message')
			this.onMessage = listener as (e: MessageEvent) => void
		else this.onError = listener as (e: Event) => void
	}

	public terminate(): void {
		this.terminated = true
	}

	public reply(data: DecodeReply): void {
		this.onMessage?.({ data } as MessageEvent)
	}

	public fail(): void {
		this.onError?.(new Event('error'))
	}
}

function fakeDetector(
	formats: string[],
	found: string[] = [],
): BarcodeDetectorConstructor & { created: { formats: string[] }[] } {
	const created: { formats: string[] }[] = []
	class Detector {
		static created = created
		static async getSupportedFormats() {
			return formats
		}
		constructor(options: { formats: string[] }) {
			created.push(options)
		}
		async detect() {
			return found.map((rawValue) => ({ rawValue }))
		}
	}
	return Detector
}

describe('createQrDecoder', () => {
	it('uses BarcodeDetector when it supports qr_code', async () => {
		const Detector = fakeDetector(['ean_13', 'qr_code'], ['ADMISSION'])
		const createWorker = vi.fn()
		const decoder = await createQrDecoder({
			barcodeDetector: Detector,
			createWorker,
		})
		expect(decoder.kind).toBe('barcode-detector')
		expect(Detector.created).toEqual([{ formats: ['qr_code'] }])
		expect(await decoder.decode(frame())).toEqual(['ADMISSION'])
		expect(createWorker).not.toHaveBeenCalled()
	})

	it('falls back to the ZXing worker when BarcodeDetector lacks qr_code', async () => {
		const worker = new FakeWorker()
		const decoder = await createQrDecoder({
			barcodeDetector: fakeDetector(['ean_13']),
			createWorker: () => worker,
		})
		expect(decoder.kind).toBe('zxing-wasm')
	})

	it('falls back to the ZXing worker without BarcodeDetector or when it throws', async () => {
		const absent = await createQrDecoder({
			barcodeDetector: undefined,
			createWorker: () => new FakeWorker(),
		})
		expect(absent.kind).toBe('zxing-wasm')

		class Broken {
			static async getSupportedFormats(): Promise<string[]> {
				throw new Error('NotSupported')
			}
			async detect() {
				return []
			}
		}
		const broken = await createQrDecoder({
			barcodeDetector: Broken,
			createWorker: () => new FakeWorker(),
		})
		expect(broken.kind).toBe('zxing-wasm')
	})
})

describe('ZxingWorkerDecoder', () => {
	async function zxing() {
		const worker = new FakeWorker()
		const decoder = await createQrDecoder({
			barcodeDetector: undefined,
			createWorker: () => worker,
		})
		return { worker, decoder }
	}

	it('sends the frame pixels to the worker by transfer and returns its texts', async () => {
		const { worker, decoder } = await zxing()
		const f = frame(4, 2)
		const pending = decoder.decode(f)
		expect(worker.requests).toHaveLength(1)
		const { message, transfer } = worker.requests[0]
		expect(message.width).toBe(4)
		expect(message.height).toBe(2)
		expect(Array.from(message.data)).toEqual(Array.from(f.data))
		expect(transfer).toEqual([message.data.buffer])
		// The caller's frame is not detached by the transfer.
		expect(message.data.buffer).not.toBe(f.data.buffer)

		worker.reply({ id: message.id, texts: ['ADMISSION'] })
		expect(await pending).toEqual(['ADMISSION'])
	})

	it('matches replies to requests and rejects a decode error', async () => {
		const { worker, decoder } = await zxing()
		const a = decoder.decode(frame())
		const b = decoder.decode(frame())
		const [ra, rb] = worker.requests.map((r) => r.message.id)
		worker.reply({ id: rb, error: 'boom' })
		worker.reply({ id: ra, texts: [] })
		expect(await a).toEqual([])
		await expect(b).rejects.toThrow('boom')
	})

	it('rejects pending decodes when the worker fails or is closed', async () => {
		const { worker, decoder } = await zxing()
		const failed = decoder.decode(frame())
		worker.fail()
		await expect(failed).rejects.toThrow()

		const closed = decoder.decode(frame())
		decoder.close()
		expect(worker.terminated).toBe(true)
		await expect(closed).rejects.toThrow()
	})
})
