import type { Params, RouteNode } from '@aurelia/router'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { DI, ILogger, resolve } from 'aurelia'
import { decodeAdmissionCode } from '../../shared/lib/admission-code/admission-code'
import { IReceptionClient } from '../services/reception-client'
import { formatJstDateTime, receptionLinkLabel } from './jst-format'
import { QrScanner } from './qr-scanner'
import { toVerdict, undecidedVerdict, type Verdict } from './verdict'

/**
 * - `opening`: Open is in flight.
 * - `ready`: the link is bound to this device.
 * - `unusable`: refused as not allowed — an unknown or revoked link, or a call
 *   not proven, which a phone clock far off also causes (the server does not
 *   tell them apart).
 * - `other-device`: the link is bound to another device.
 * - `throttled`: too many unknown links were tried from here.
 * - `unreachable`: Open could not reach the server.
 */
export type ReceptionPhase =
	| 'opening'
	| 'ready'
	| 'unusable'
	| 'other-device'
	| 'throttled'
	| 'unreachable'

/** Where the current time stands against the reception window. */
export type WindowState = 'inside' | 'before' | 'after' | 'none'

/** Builds the scanner for a video element; replaced by a fake in tests. */
export type QrScannerFactory = (
	video: HTMLVideoElement,
	onText: (text: string) => Promise<void>,
) => Pick<QrScanner, 'start' | 'stop'>

export const IQrScannerFactory = DI.createInterface<QrScannerFactory>(
	'IQrScannerFactory',
	(x) => x.instance((video, onText) => new QrScanner(video, onText)),
)

/** A link token as the schema allows it; anything else is no link at all. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/

/** A decided code is not sent again for this long (it rotates every 15 s). */
const DECIDED_COOLDOWN_MS = 20_000
/** An undecided code is retried by the camera no sooner than this. */
const UNDECIDED_COOLDOWN_MS = 3_000

/**
 * The reception screen venue staff open from a ReceptionLink in a browser tab,
 * without a sign-in or an install (the route sets `auth: false`). On first
 * open this device creates its key pair and binds the link to it (Open); every
 * later call is signed by it. Inside the reception window staff tap to start
 * the rear camera; each QR code read is sent to Admit and the verdict is shown
 * large, in colour and text, without any personal data. When the server
 * cannot be reached the scan is shown as not decided — never OK.
 */
export class ReceptionRoute {
	public phase: ReceptionPhase = 'opening'
	public linkToken = ''
	public linkLabel = ''
	public windowState: WindowState = 'none'
	/** `2026-11-20 15:00`, Japan time. */
	public windowOpenLabel = ''
	public windowCloseLabel = ''

	public scanning = false
	public startingCamera = false
	public cameraError = ''

	/** The last scan's verdict, shown until the next scan is decided. */
	public verdict: Verdict | null = null
	public deciding = false

	/** Bound to the `<video>` element in the template. */
	public video: HTMLVideoElement | null = null

	private scanner: Pick<QrScanner, 'start' | 'stop'> | null = null
	private undecidedText = ''
	private readonly recent = new Map<string, number>()
	private abort: AbortController | null = null

	private readonly client = resolve(IReceptionClient)
	private readonly scannerFactory = resolve(IQrScannerFactory)
	private readonly logger = resolve(ILogger).scopeTo('ReceptionRoute')

	private readonly onVisibilityChange = (): void => {
		// A hidden tab loses the camera anyway; release it cleanly.
		if (document.visibilityState === 'hidden') this.stopScanning()
	}

	/**
	 * The link token travels in the URL fragment (`/reception#<token>`), which
	 * browsers never send to a server, so it stays out of request paths and
	 * access logs.
	 */
	public canLoad(_params: Params, next?: RouteNode): boolean {
		this.linkToken = tokenFromFragment(
			window.location.hash || next?.fragment || '',
		)
		return true
	}

	public attached(): void {
		document.addEventListener('visibilitychange', this.onVisibilityChange)
		void this.open()
	}

	public detaching(): void {
		document.removeEventListener('visibilitychange', this.onVisibilityChange)
		this.abort?.abort()
		this.stopScanning()
	}

	public get canScan(): boolean {
		return this.phase === 'ready' && this.windowState === 'inside'
	}

	/** Opens the link on this device (binding it on first use). */
	public async open(): Promise<void> {
		this.abort?.abort()
		const abort = new AbortController()
		this.abort = abort
		this.phase = 'opening'
		if (!TOKEN_PATTERN.test(this.linkToken)) {
			this.phase = 'unusable'
			return
		}
		try {
			const res = await this.client.open(this.linkToken, abort.signal)
			if (abort.signal.aborted) return
			const number = res.receptionLink?.number?.value
			this.linkLabel = number ? receptionLinkLabel(number) : ''
			const win = res.receptionWindow
			const openTime = win?.openTime ? timestampDate(win.openTime) : null
			const closeTime = win?.closeTime ? timestampDate(win.closeTime) : null
			this.windowOpenLabel = openTime ? formatJstDateTime(openTime) : ''
			this.windowCloseLabel = closeTime ? formatJstDateTime(closeTime) : ''
			this.windowState = res.insideWindow
				? 'inside'
				: !openTime || !closeTime
					? 'none'
					: Date.now() < openTime.getTime()
						? 'before'
						: 'after'
			this.phase = 'ready'
		} catch (err) {
			if (abort.signal.aborted) return
			this.phase = phaseForOpenError(err)
			this.logger.warn('Open failed', { phase: this.phase, error: err })
		}
	}

	/** Staff tapped to start: ask for the rear camera and scan until stopped. */
	public async startScanning(): Promise<void> {
		if (!this.canScan || this.scanning || this.startingCamera || !this.video)
			return
		this.cameraError = ''
		this.startingCamera = true
		const scanner = this.scannerFactory(this.video, (text) =>
			this.onScanned(text),
		)
		this.scanner = scanner
		try {
			await scanner.start()
			this.scanning = true
		} catch (err) {
			this.scanner = null
			this.cameraError =
				'カメラを使えませんでした。ブラウザの設定でカメラを許可してから、もう一度お試しください。'
			this.logger.warn('Camera failed', { error: err })
		} finally {
			this.startingCamera = false
		}
	}

	public stopScanning(): void {
		this.scanner?.stop()
		this.scanner = null
		this.scanning = false
	}

	/** Sends the scan that could not be decided once more. */
	public async retry(): Promise<void> {
		if (!this.undecidedText || this.deciding) return
		await this.decide(this.undecidedText)
	}

	/** A QR code was read by the camera. */
	public async onScanned(text: string): Promise<void> {
		const now = Date.now()
		for (const [key, until] of this.recent)
			if (until <= now) this.recent.delete(key)
		if (this.recent.has(text) || this.recent.has(groupKey(text) ?? text)) return
		await this.decide(text)
	}

	private async decide(text: string): Promise<void> {
		if (this.deciding) return
		this.deciding = true
		try {
			const res = await this.client.admit(this.linkToken, text)
			const verdict = toVerdict(res)
			this.verdict = verdict
			this.undecidedText = ''
			const until = Date.now() + DECIDED_COOLDOWN_MS
			this.recent.set(text, until)
			// The fan's phone shows a new code every 15 s: once let in, the same
			// group is not sent again while it is still in front of the camera.
			const group = groupKey(text)
			if (group && verdict.admittedCount > 0) this.recent.set(group, until)
		} catch (err) {
			this.onAdmitError(text, err)
		} finally {
			this.deciding = false
		}
	}

	private onAdmitError(text: string, err: unknown): void {
		const code = err instanceof ConnectError ? err.code : undefined
		this.logger.warn('Admit failed', { code, error: err })
		if (code === Code.PermissionDenied) {
			// Revoked (or never usable): every further call is refused.
			this.verdict = null
			this.stopScanning()
			this.phase = 'unusable'
			return
		}
		if (code === Code.FailedPrecondition) {
			// Outside the reception window: read the window again.
			this.verdict = null
			this.stopScanning()
			void this.open()
			return
		}
		// Not decided (no connection, timeout, server failure): never OK.
		this.verdict = undecidedVerdict()
		this.undecidedText = text
		// Retried by itself while the code stays in view, at most every 3 s
		// (also across the codes the fan's phone renews meanwhile).
		const until = Date.now() + UNDECIDED_COOLDOWN_MS
		this.recent.set(text, until)
		const group = groupKey(text)
		if (group) this.recent.set(group, until)
	}
}

/** The token from a URL fragment such as `#<token>`. */
export function tokenFromFragment(fragment: string): string {
	// The token alphabet is base64url, which needs no percent-decoding.
	return fragment.replace(/^#/, '')
}

function phaseForOpenError(err: unknown): ReceptionPhase {
	if (!(err instanceof ConnectError)) return 'unreachable'
	switch (err.code) {
		case Code.PermissionDenied:
		case Code.InvalidArgument:
			return 'unusable'
		case Code.FailedPrecondition:
			return 'other-device'
		case Code.ResourceExhausted:
			return 'throttled'
		default:
			return 'unreachable'
	}
}

/** The same fan's group of tickets, across the codes their phone rotates through. */
function groupKey(text: string): string | null {
	const decoded = decodeAdmissionCode(text)
	if (!decoded) return null
	return `group:${decoded.userId}:${decoded.eventId}:${decoded.ticketIds.join(',')}`
}
