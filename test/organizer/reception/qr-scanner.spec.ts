import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QrDecoder } from '../../../organizer/reception/decoder/qr-decoder'
import {
	CAMERA_CONSTRAINTS,
	QrScanner,
	type ScannerDeps,
} from '../../../organizer/reception/qr-scanner'

function fakeStream() {
	const track = { stop: vi.fn() }
	return {
		stream: { getTracks: () => [track] } as unknown as MediaStream,
		track,
	}
}

function fakeVideo(): HTMLVideoElement {
	const video = document.createElement('video')
	video.play = vi.fn().mockResolvedValue(undefined)
	return video
}

/** A decoder double that returns the queued results, one per frame. */
function fakeDecoder(
	results: string[][],
): QrDecoder & { close: ReturnType<typeof vi.fn> } {
	return {
		kind: 'zxing-wasm',
		decode: vi.fn(async () => results.shift() ?? []),
		close: vi.fn(),
	}
}

function deps(decoder: QrDecoder, overrides: Partial<ScannerDeps> = {}) {
	const { stream, track } = fakeStream()
	const timers: (() => void)[] = []
	const d: ScannerDeps = {
		getUserMedia: vi.fn().mockResolvedValue(stream),
		createDecoder: vi.fn().mockResolvedValue(decoder),
		grabFrame: () => ({ width: 1, height: 1 }) as ImageData,
		setTimeout: (cb) => timers.push(cb),
		clearTimeout: vi.fn(),
		...overrides,
	}
	return { d, track, timers, stream }
}

describe('QrScanner', () => {
	afterEach(() => vi.restoreAllMocks())

	it('asks for the rear camera only when started', async () => {
		const decoder = fakeDecoder([])
		const { d, stream } = deps(decoder)
		const video = fakeVideo()
		const scanner = new QrScanner(video, vi.fn(), d)
		expect(d.getUserMedia).not.toHaveBeenCalled()

		await scanner.start()
		expect(d.getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS)
		expect(CAMERA_CONSTRAINTS.video).toEqual({
			facingMode: { ideal: 'environment' },
		})
		expect(video.srcObject).toBe(stream)
		expect(scanner.decoderKind).toBe('zxing-wasm')
	})

	it('scans continuously, handing each decoded text over one at a time', async () => {
		const decoder = fakeDecoder([[], ['A'], ['B']])
		const { d, timers } = deps(decoder)
		const onText = vi.fn().mockResolvedValue(undefined)
		const scanner = new QrScanner(fakeVideo(), onText, d)
		await scanner.start()
		expect(timers).toHaveLength(1)

		for (let i = 0; i < 3; i++) {
			timers.shift()
			await scanner.tick()
		}
		expect(onText.mock.calls).toEqual([['A'], ['B']])
		// Still scanning: the next frame is scheduled.
		expect(timers).toHaveLength(1)
	})

	it('treats a decode failure as a frame without a code', async () => {
		const decoder = fakeDecoder([])
		vi.mocked(decoder.decode).mockRejectedValueOnce(new Error('bad frame'))
		const { d, timers } = deps(decoder)
		const onText = vi.fn()
		const scanner = new QrScanner(fakeVideo(), onText, d)
		await scanner.start()
		timers.shift()
		await scanner.tick()
		expect(onText).not.toHaveBeenCalled()
		expect(timers).toHaveLength(1)
	})

	it('turns the camera off and closes the decoder when stopped', async () => {
		const decoder = fakeDecoder([['A']])
		const { d, track, timers } = deps(decoder)
		const onText = vi.fn()
		const video = fakeVideo()
		const scanner = new QrScanner(video, onText, d)
		await scanner.start()
		scanner.stop()
		expect(track.stop).toHaveBeenCalled()
		expect(decoder.close).toHaveBeenCalled()
		expect(video.srcObject).toBeNull()
		expect(timers).toHaveLength(1)
		await scanner.tick()
		expect(onText).not.toHaveBeenCalled()
	})

	it('rejects and releases everything when the camera is refused', async () => {
		const decoder = fakeDecoder([])
		const { d } = deps(decoder, {
			getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
		})
		const scanner = new QrScanner(fakeVideo(), vi.fn(), d)
		await expect(scanner.start()).rejects.toThrow('NotAllowedError')
		expect(decoder.close).toHaveBeenCalled()
	})
})
