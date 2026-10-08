/**
 * TEMPORARY SPIKE (OpenSpec ticket-wallet-and-checkin, task 0.4). Delete this
 * directory, its route and its tests once the measurements are recorded in
 * design.md.
 *
 * Pure helpers of the AdmissionCode QR spike page: the dev-only gate, the
 * payload layout check a scan must pass, and the run records.
 */
import type { AppConfig } from '../../shared/config/app-config'
import { decodeAdmissionCode } from '../../shared/lib/admission-code/admission-code'
import { base45Decode } from '../../shared/lib/admission-code/base45'

/** The spike page exists only where the runtime config says `dev`. */
export function isSpikeEnabled(
	config: Pick<AppConfig, 'environment'> | null | undefined,
): boolean {
	return config?.environment === 'dev'
}

/** What a scanned text turned out to be. */
export type LayoutCheck =
	| { readonly ok: true; readonly ticketCount: number; readonly bytes: number }
	| { readonly ok: false; readonly reason: 'not-base45' | 'bad-layout' }

/**
 * Whether scanned text is an AdmissionCode of layout version 1 (Base45 →
 * bytes → version, ticket count 1-10, exact length, distinct tickets). The
 * signature is not checked: the spike measures decoding, not trust.
 */
export function checkLayout(text: string): LayoutCheck {
	const bytes = base45Decode(text)
	if (!bytes) return { ok: false, reason: 'not-base45' }
	const decoded = decodeAdmissionCode(text)
	if (!decoded) return { ok: false, reason: 'bad-layout' }
	return {
		ok: true,
		ticketCount: decoded.ticketIds.length,
		bytes: bytes.length,
	}
}

export type DecoderKind = 'barcode-detector' | 'paulmillr-worker'
export type BrightnessLabel = 'normal' | 'low'

/** One measured scan: from "start scan" to the first valid AdmissionCode. */
export interface SpikeRun {
	readonly decoder: DecoderKind
	readonly ticketCount: number
	readonly ms: number
	/** Frames handed to the decoder, the successful one included. */
	readonly frames: number
	/** Frames in which the decoder found no QR text. */
	readonly failures: number
	/** Frames whose QR text was not an AdmissionCode (ignored, but counted). */
	readonly ignored: number
	readonly brightness: BrightnessLabel
	readonly userAgent: string
	/** ISO 8601. */
	readonly timestamp: string
}

export interface RunInput {
	readonly decoder: DecoderKind
	readonly ticketCount: number
	readonly startedAt: number
	readonly decodedAt: number
	readonly frames: number
	readonly failures: number
	readonly ignored: number
	readonly brightness: BrightnessLabel
	readonly userAgent: string
	readonly now: Date
}

export function buildRun(input: RunInput): SpikeRun {
	return {
		decoder: input.decoder,
		ticketCount: input.ticketCount,
		ms: Math.max(0, Math.round(input.decodedAt - input.startedAt)),
		frames: input.frames,
		failures: input.failures,
		ignored: input.ignored,
		brightness: input.brightness,
		userAgent: input.userAgent,
		timestamp: input.now.toISOString(),
	}
}

export const RUNS_STORAGE_KEY = 'spike-admission-qr.runs'

/** Runs kept in localStorage; unreadable or malformed storage gives []. */
export function loadRuns(
	storage: Pick<Storage, 'getItem'> | undefined,
): SpikeRun[] {
	try {
		const raw = storage?.getItem(RUNS_STORAGE_KEY)
		if (!raw) return []
		const parsed: unknown = JSON.parse(raw)
		return Array.isArray(parsed) ? (parsed as SpikeRun[]) : []
	} catch {
		return []
	}
}

export function saveRuns(
	storage: Pick<Storage, 'setItem'> | undefined,
	runs: readonly SpikeRun[],
): void {
	try {
		storage?.setItem(RUNS_STORAGE_KEY, JSON.stringify(runs))
	} catch {
		// Private mode or quota: the table still shows this session's runs.
	}
}
