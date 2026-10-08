/**
 * TEMPORARY SPIKE (OpenSpec ticket-wallet-and-checkin, task 0.4). Delete this
 * directory, its route in organizer-shell and its tests once the measurements
 * are recorded in design.md.
 *
 * `/spike/admission-qr`, dev only: a "fan phone" generator that shows a real
 * AdmissionCode QR code for 1, 3 or 10 tickets (throwaway key, random ids,
 * re-signed every 15 s), and a "reception phone" scanner that times the rear
 * camera decode with BarcodeDetector or @paulmillr/qr in a Web Worker.
 */
import { ILogger, resolve } from 'aurelia'
import { IAppConfig } from '../../shared/config/app-config'
import {
	CODE_ROTATION_MS,
	signAdmissionCode,
} from '../../shared/lib/admission-code/admission-code'
import { base45Decode } from '../../shared/lib/admission-code/base45'
import { admissionQrDataUrl } from '../../shared/lib/admission-code/qr-svg'
import QrDecodeWorker from './qr-decode.worker?worker&inline'
import {
	type BrightnessLabel,
	buildRun,
	checkLayout,
	type DecoderKind,
	isSpikeEnabled,
	loadRuns,
	type SpikeRun,
	saveRuns,
} from './spike-lib'

type Mode = 'generator' | 'scanner'

/** Frames larger than this (longest side, px) are scaled down for the worker. */
const MAX_FRAME_SIDE = 1280

interface BarcodeDetectorLike {
	detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

interface BarcodeDetectorCtor {
	new (options: { formats: string[] }): BarcodeDetectorLike
	getSupportedFormats(): Promise<string[]>
}

function barcodeDetectorCtor(): BarcodeDetectorCtor | undefined {
	return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor })
		.BarcodeDetector
}

function safeLocalStorage(): Storage | undefined {
	try {
		return window.localStorage
	} catch {
		return undefined
	}
}

export class SpikeAdmissionQrRoute {
	private readonly logger = resolve(ILogger).scopeTo('SpikeAdmissionQr')
	private readonly config = resolve(IAppConfig)

	public readonly enabled = isSpikeEnabled(this.config)
	public mode: Mode = 'generator'

	// ── Generator ────────────────────────────────────────────────────────────
	public readonly ticketCounts = [1, 3, 10] as const
	public ticketCount: 1 | 3 | 10 = 1
	public dim = false
	public codeImage = ''
	public codeBytes = 0
	public codeChars = 0
	public signedAt = ''
	private keyPair: CryptoKeyPair | null = null
	private readonly userId = crypto.randomUUID()
	private readonly eventId = crypto.randomUUID()
	private ticketIds: string[] = []
	private rotation: ReturnType<typeof setInterval> | null = null

	// ── Scanner ──────────────────────────────────────────────────────────────
	public video!: HTMLVideoElement
	public decoder: DecoderKind = 'paulmillr-worker'
	public brightness: BrightnessLabel = 'normal'
	/** null while unknown; false when BarcodeDetector lacks qr_code. */
	public barcodeSupported: boolean | null = null
	public scanning = false
	public status = ''
	public frames = 0
	public failures = 0
	public ignored = 0
	public jsonPre!: HTMLPreElement
	public runs: SpikeRun[] = []
	private stream: MediaStream | null = null
	private worker: Worker | null = null
	private scanToken = 0

	public canLoad(): boolean {
		return this.enabled
	}

	public attached(): void {
		if (!this.enabled) return
		this.runs = loadRuns(safeLocalStorage())
		void this.detectBarcodeSupport()
		void this.startGenerator()
	}

	public detaching(): void {
		this.stopGenerator()
		this.stopScan()
		this.worker?.terminate()
		this.worker = null
	}

	public setMode(mode: Mode): void {
		this.mode = mode
		if (mode === 'generator') {
			this.stopScan()
			void this.startGenerator()
		} else {
			this.stopGenerator()
		}
	}

	// ── Generator ────────────────────────────────────────────────────────────

	public setTicketCount(count: 1 | 3 | 10): void {
		this.ticketCount = count
		this.ticketIds = []
		void this.sign()
	}

	public toggleDim(): void {
		this.dim = !this.dim
	}

	private async startGenerator(): Promise<void> {
		this.stopGenerator()
		if (!this.keyPair) {
			this.keyPair = await crypto.subtle.generateKey(
				{ name: 'ECDSA', namedCurve: 'P-256' },
				false,
				['sign', 'verify'],
			)
		}
		await this.sign()
		this.rotation = setInterval(() => void this.sign(), CODE_ROTATION_MS)
	}

	private stopGenerator(): void {
		if (this.rotation !== null) clearInterval(this.rotation)
		this.rotation = null
	}

	private async sign(): Promise<void> {
		if (!this.keyPair) return
		if (this.ticketIds.length !== this.ticketCount) {
			this.ticketIds = Array.from({ length: this.ticketCount }, () =>
				crypto.randomUUID(),
			)
		}
		const now = new Date()
		const text = await signAdmissionCode(this.keyPair.privateKey, {
			userId: this.userId,
			eventId: this.eventId,
			ticketIds: this.ticketIds,
			signTime: Math.floor(now.getTime() / 1000),
		})
		this.codeImage = admissionQrDataUrl(text)
		this.codeBytes = base45Decode(text)?.length ?? 0
		this.codeChars = text.length
		this.signedAt = now.toLocaleTimeString()
	}

	// ── Scanner ──────────────────────────────────────────────────────────────

	private async detectBarcodeSupport(): Promise<void> {
		const ctor = barcodeDetectorCtor()
		if (!ctor) {
			this.barcodeSupported = false
			return
		}
		try {
			this.barcodeSupported = (await ctor.getSupportedFormats()).includes(
				'qr_code',
			)
		} catch {
			this.barcodeSupported = false
		}
	}

	/** Start the rear camera and time the first valid AdmissionCode. */
	public async startScan(): Promise<void> {
		if (this.scanning) return
		const token = ++this.scanToken
		const startedAt = performance.now()
		this.scanning = true
		this.frames = 0
		this.failures = 0
		this.ignored = 0
		this.status = 'Starting camera…'
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' } },
				audio: false,
			})
			if (token !== this.scanToken) {
				// Stopped or left the page while the permission prompt was open.
				for (const track of stream.getTracks()) track.stop()
				return
			}
			this.stream = stream
			this.video.srcObject = stream
			await this.video.play()
		} catch (err) {
			this.logger.warn('Camera failed', { error: err })
			this.status = `Camera failed: ${(err as Error).message}`
			this.stopScan()
			return
		}
		this.status = 'Scanning…'

		const decode =
			this.decoder === 'barcode-detector'
				? this.barcodeDecoder()
				: this.workerDecoder()
		if (!decode) {
			this.status = 'BarcodeDetector does not support qr_code here'
			this.stopScan()
			return
		}

		while (this.scanning && token === this.scanToken) {
			await nextFrame(this.video)
			if (!this.scanning || token !== this.scanToken) return
			this.frames++
			let text: string | null = null
			try {
				text = await decode()
			} catch {
				text = null
			}
			if (text === null) {
				this.failures++
				continue
			}
			const check = checkLayout(text)
			if (!check.ok) {
				this.ignored++
				continue
			}
			const run = buildRun({
				decoder: this.decoder,
				ticketCount: check.ticketCount,
				startedAt,
				decodedAt: performance.now(),
				frames: this.frames,
				failures: this.failures,
				ignored: this.ignored,
				brightness: this.brightness,
				userAgent: navigator.userAgent,
				now: new Date(),
			})
			this.runs = [run, ...this.runs]
			saveRuns(safeLocalStorage(), this.runs)
			this.status = `OK: ${run.ticketCount} tickets in ${run.ms} ms (${run.frames} frames)`
			this.stopScan()
			return
		}
	}

	public stopScan(): void {
		this.scanning = false
		this.scanToken++
		for (const track of this.stream?.getTracks() ?? []) track.stop()
		this.stream = null
		if (this.video) this.video.srcObject = null
	}

	private barcodeDecoder(): (() => Promise<string | null>) | null {
		const ctor = barcodeDetectorCtor()
		if (!ctor || this.barcodeSupported === false) return null
		const detector = new ctor({ formats: ['qr_code'] })
		return async () => (await detector.detect(this.video))[0]?.rawValue ?? null
	}

	private workerDecoder(): () => Promise<string | null> {
		if (!this.worker) {
			// Inlined as a blob worker so the spike adds no file outside the
			// organizer chunks (the consumer SW precaches top-level assets).
			this.worker = new QrDecodeWorker()
		}
		const worker = this.worker
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		let nextId = 0
		return () =>
			new Promise<string | null>((done) => {
				const { videoWidth: w, videoHeight: h } = this.video
				if (!ctx || w === 0 || h === 0) {
					done(null)
					return
				}
				const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(w, h))
				canvas.width = Math.round(w * scale)
				canvas.height = Math.round(h * scale)
				ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height)
				const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
				const id = ++nextId
				const onMessage = (
					e: MessageEvent<{ id: number; text: string | null }>,
				) => {
					if (e.data.id !== id) return
					worker.removeEventListener('message', onMessage)
					done(e.data.text)
				}
				worker.addEventListener('message', onMessage)
				worker.postMessage(
					{ id, width: image.width, height: image.height, data: image.data },
					[image.data.buffer],
				)
			})
	}

	// ── Runs ─────────────────────────────────────────────────────────────────

	public get runsJson(): string {
		return JSON.stringify(this.runs, null, 2)
	}

	public async copyRuns(): Promise<void> {
		try {
			await navigator.clipboard.writeText(this.runsJson)
			this.status = `Copied ${this.runs.length} runs as JSON`
		} catch {
			this.status = 'Copy failed: the JSON below is selected, copy it by hand'
			this.selectJson()
		}
	}

	/** Fallback for copy: open the JSON and select its text. */
	private selectJson(): void {
		const details = this.jsonPre?.closest('details')
		if (!details) return
		details.open = true
		window.getSelection()?.selectAllChildren(this.jsonPre)
	}

	public clearRuns(): void {
		this.runs = []
		saveRuns(safeLocalStorage(), this.runs)
	}
}

/** Resolve on the next video frame (or animation frame where unsupported). */
function nextFrame(video: HTMLVideoElement): Promise<void> {
	return new Promise((done) => {
		const v = video as HTMLVideoElement & {
			requestVideoFrameCallback?: (cb: () => void) => number
		}
		if (typeof v.requestVideoFrameCallback === 'function') {
			v.requestVideoFrameCallback(() => done())
		} else {
			requestAnimationFrame(() => done())
		}
	})
}
