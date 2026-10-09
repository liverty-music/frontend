import { createQrDecoder, type QrDecoder } from './decoder/qr-decoder'

/**
 * The rear camera, asked for only when staff start scanning. `ideal` (not
 * `exact`) so a device without a rear camera still opens one.
 */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
	audio: false,
	video: { facingMode: { ideal: 'environment' } },
}

/** Pause between two decode attempts, so decoding never hogs the device. */
const FRAME_INTERVAL_MS = 100

/** Frames are scaled down to at most this width before decoding. */
const MAX_FRAME_WIDTH = 960

export interface ScannerDeps {
	getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
	createDecoder(): Promise<QrDecoder>
	/** The current video frame, or null while the video has no frame yet. */
	grabFrame(video: HTMLVideoElement): ImageData | null
	setTimeout(cb: () => void, ms: number): number
	clearTimeout(handle: number): void
}

let frameCanvas: HTMLCanvasElement | null = null

/** Draws the current video frame, scaled down, and reads its pixels. */
export function grabVideoFrame(video: HTMLVideoElement): ImageData | null {
	const { videoWidth, videoHeight } = video
	if (videoWidth === 0 || videoHeight === 0) return null
	const scale = Math.min(1, MAX_FRAME_WIDTH / videoWidth)
	const width = Math.round(videoWidth * scale)
	const height = Math.round(videoHeight * scale)
	frameCanvas ??= document.createElement('canvas')
	frameCanvas.width = width
	frameCanvas.height = height
	const ctx = frameCanvas.getContext('2d', { willReadFrequently: true })
	if (!ctx) return null
	ctx.drawImage(video, 0, 0, width, height)
	return ctx.getImageData(0, 0, width, height)
}

export function browserScannerDeps(): ScannerDeps {
	return {
		getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
		createDecoder: () => createQrDecoder(),
		grabFrame: grabVideoFrame,
		setTimeout: (cb, ms) => window.setTimeout(cb, ms),
		clearTimeout: (h) => window.clearTimeout(h),
	}
}

/**
 * Scans continuously from the camera until stopped: grabs a frame, decodes it
 * through the {@link QrDecoder} interface, and hands each text found to
 * `onText`. The next frame is read only after `onText` settles, so one scan is
 * decided at a time.
 */
export class QrScanner {
	private stream: MediaStream | null = null
	private decoder: QrDecoder | null = null
	private timer: number | null = null
	private running = false

	constructor(
		private readonly video: HTMLVideoElement,
		private readonly onText: (text: string) => Promise<void>,
		private readonly deps: ScannerDeps = browserScannerDeps(),
	) {}

	public get decoderKind(): QrDecoder['kind'] | null {
		return this.decoder?.kind ?? null
	}

	/** Asks for the camera and starts scanning. Rejects when the camera is refused. */
	public async start(): Promise<void> {
		if (this.running) return
		this.running = true
		try {
			const [stream, decoder] = await Promise.allSettled([
				this.deps.getUserMedia(CAMERA_CONSTRAINTS),
				this.deps.createDecoder(),
			])
			// Keep whichever succeeded, so a failure of the other releases it.
			if (stream.status === 'fulfilled') this.stream = stream.value
			if (decoder.status === 'fulfilled') this.decoder = decoder.value
			if (stream.status === 'rejected') throw stream.reason
			if (decoder.status === 'rejected') throw decoder.reason
			const media = stream.value
			if (!this.running) {
				this.release()
				return
			}
			this.video.srcObject = media
			this.video.muted = true
			this.video.playsInline = true
			await this.video.play()
		} catch (err) {
			this.running = false
			this.release()
			throw err
		}
		this.scheduleNext()
	}

	/** Stops scanning and turns the camera off. */
	public stop(): void {
		this.running = false
		if (this.timer !== null) this.deps.clearTimeout(this.timer)
		this.timer = null
		this.release()
	}

	private release(): void {
		for (const track of this.stream?.getTracks() ?? []) track.stop()
		this.stream = null
		this.video.srcObject = null
		this.decoder?.close()
		this.decoder = null
	}

	private scheduleNext(): void {
		if (!this.running) return
		this.timer = this.deps.setTimeout(() => void this.tick(), FRAME_INTERVAL_MS)
	}

	/** One frame: decode, hand over what was found, schedule the next. */
	public async tick(): Promise<void> {
		this.timer = null
		const decoder = this.decoder
		if (!this.running || !decoder) return
		try {
			const frame = this.deps.grabFrame(this.video)
			const texts = frame ? await decoder.decode(frame) : []
			if (this.running && texts.length > 0) await this.onText(texts[0])
		} catch {
			// A frame that fails to decode is just a frame without a code.
		}
		this.scheduleNext()
	}
}
