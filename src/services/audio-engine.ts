import { DI } from 'aurelia'
import { StorageKeys } from '../constants/storage-keys'

/**
 * Major pentatonic scale degrees (semitone offsets within one octave).
 * Any subset of these intervals is mutually consonant, so quantizing every
 * tap onto these degrees guarantees no dissonant interval can occur — the
 * core trick that keeps rapid tapping musical.
 */
const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9]

/** MIDI note for the lowest scale degree (C4). */
const BASE_MIDI = 60
/** A4 reference pitch in Hz for MIDI→frequency conversion. */
const A4_HZ = 440
/** Number of octaves the hue range (0–360°) is spread across. */
const HUE_OCTAVE_SPAN = 2
/** Hard cap on simultaneously sounding voices to bound CPU usage. */
const MAX_VOICES = 16

/** Combo window: taps within this gap (ms) keep climbing the scale. */
const COMBO_WINDOW_MS = 600
/** Maximum number of pentatonic degrees the combo can climb. */
const MAX_COMBO_STEPS = 5
/** Combo step at which an extra overtone voice is layered in. */
const OVERTONE_COMBO_THRESHOLD = 2

const DEFAULT_VOLUME = 0.5

function midiToFreq(midi: number): number {
	return A4_HZ * 2 ** ((midi - 69) / 12)
}

/** Convert a scale index (degrees above BASE_MIDI) into a MIDI note. */
function scaleIndexToMidi(index: number): number {
	const len = PENTATONIC.length
	const octave = Math.floor(index / len)
	const degree = ((index % len) + len) % len
	return BASE_MIDI + octave * 12 + PENTATONIC[degree]
}

/** Map a 0–360° hue deterministically onto a pentatonic scale index. */
function hueToScaleIndex(hue: number, span = HUE_OCTAVE_SPAN): number {
	const normalized = ((hue % 360) + 360) % 360
	const totalDegrees = PENTATONIC.length * span
	return Math.min(
		totalDegrees - 1,
		Math.floor((normalized / 360) * totalDegrees),
	)
}

/**
 * Deterministically map a bubble hue (0–360°) to a frequency quantized to a
 * major pentatonic scale. The same hue always yields the same pitch, and any
 * sequence of taps is guaranteed consonant.
 */
export function hueToPentatonicPitch(hue: number): number {
	return midiToFreq(scaleIndexToMidi(hueToScaleIndex(hue)))
}

interface Voice {
	osc: OscillatorNode
	gain: GainNode
	startedAt: number
}

interface ToneOptions {
	type: OscillatorType
	attack: number
	decay: number
	peak: number
}

export interface IAudioEngine {
	readonly muted: boolean
	readonly volume: number
	unlock(): void
	suspend(): void
	resume(): void
	playTap(hue: number): void
	playLanding(hue: number): void
	setMuted(muted: boolean): void
	setVolume(volume: number): void
}

export const IAudioEngine = DI.createInterface<IAudioEngine>(
	'IAudioEngine',
	(x) => x.singleton(AudioEngine),
)

/**
 * Low-latency, polyphonic Web Audio sound engine for discovery bubble
 * feedback. Tones are synthesized procedurally (no audio assets) so each
 * tap's pitch can be derived from the bubble's hue.
 *
 * The AudioContext is created lazily and only resumed inside a user gesture
 * (`unlock`), complying with browser autoplay policy. Under the iOS hardware
 * mute switch, Web Audio is silent by design — this is intentional,
 * ringer-respecting behavior and is not worked around.
 */
export class AudioEngine implements IAudioEngine {
	private ctx: AudioContext | null = null
	private master: GainNode | null = null
	private voices: Voice[] = []

	private _muted: boolean
	private _volume: number

	private comboSteps = 0
	private lastTapAt = 0

	constructor() {
		this._muted = localStorage.getItem(StorageKeys.soundMuted) === '1'
		const storedRaw = localStorage.getItem(StorageKeys.soundVolume)
		// Distinguish "no preference stored" (null) from a real stored 0;
		// Number(null ?? '') would be 0 and silently override DEFAULT_VOLUME.
		const storedVolume = storedRaw === null ? Number.NaN : Number(storedRaw)
		this._volume =
			Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 1
				? storedVolume
				: DEFAULT_VOLUME
	}

	public get muted(): boolean {
		return this._muted
	}

	public get volume(): number {
		return this._volume
	}

	/** Create/resume the AudioContext. MUST be called from a user gesture. */
	public unlock(): void {
		this.ensureContext()
		if (this.ctx?.state === 'suspended') {
			void this.ctx.resume()
		}
	}

	public suspend(): void {
		if (this.ctx?.state === 'running') {
			void this.ctx.suspend()
		}
	}

	public resume(): void {
		if (this.ctx?.state === 'suspended') {
			void this.ctx.resume()
		}
	}

	public playTap(hue: number): void {
		if (!this.ctx || !this.master) return

		this.advanceCombo()
		const index = hueToScaleIndex(hue) + this.comboSteps
		const freq = midiToFreq(scaleIndexToMidi(index))

		this.spawnVoice(freq, {
			type: 'triangle',
			attack: 0.004,
			decay: 0.18,
			peak: 0.9,
		})

		// Layer a soft fifth overtone once the combo builds, for added richness.
		if (this.comboSteps >= OVERTONE_COMBO_THRESHOLD) {
			const overtone = midiToFreq(scaleIndexToMidi(index + PENTATONIC.length))
			this.spawnVoice(overtone, {
				type: 'sine',
				attack: 0.006,
				decay: 0.16,
				peak: 0.35,
			})
		}
	}

	public playLanding(hue: number): void {
		if (!this.ctx || !this.master) return
		// An octave below the tap tone, softer and longer — a gentle "settle".
		const freq = hueToPentatonicPitch(hue) / 2
		this.spawnVoice(freq, {
			type: 'sine',
			attack: 0.012,
			decay: 0.34,
			peak: 0.5,
		})
	}

	public setMuted(muted: boolean): void {
		this._muted = muted
		localStorage.setItem(StorageKeys.soundMuted, muted ? '1' : '0')
		this.applyMasterGain()
	}

	public setVolume(volume: number): void {
		this._volume = Math.min(1, Math.max(0, volume))
		localStorage.setItem(StorageKeys.soundVolume, String(this._volume))
		this.applyMasterGain()
	}

	private ensureContext(): void {
		if (this.ctx) return
		const Ctor =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext
		if (!Ctor) return
		this.ctx = new Ctor()
		this.master = this.ctx.createGain()
		this.applyMasterGain()
		this.master.connect(this.ctx.destination)
	}

	private applyMasterGain(): void {
		if (!this.master) return
		this.master.gain.value = this._muted ? 0 : this._volume
	}

	private advanceCombo(): void {
		const now = performance.now()
		this.comboSteps =
			now - this.lastTapAt <= COMBO_WINDOW_MS
				? Math.min(MAX_COMBO_STEPS, this.comboSteps + 1)
				: 0
		this.lastTapAt = now
	}

	private spawnVoice(freq: number, opts: ToneOptions): void {
		const ctx = this.ctx
		const master = this.master
		if (!ctx || !master) return

		const t = ctx.currentTime
		const osc = ctx.createOscillator()
		osc.type = opts.type
		osc.frequency.setValueAtTime(freq, t)

		const gain = ctx.createGain()
		const end = t + opts.attack + opts.decay
		gain.gain.setValueAtTime(0.0001, t)
		gain.gain.linearRampToValueAtTime(opts.peak, t + opts.attack)
		gain.gain.exponentialRampToValueAtTime(0.0001, end)

		osc.connect(gain)
		gain.connect(master)
		osc.start(t)
		osc.stop(end + 0.02)

		const voice: Voice = { osc, gain, startedAt: t }
		this.voices.push(voice)
		this.enforceVoiceCap()

		osc.onended = (): void => {
			osc.disconnect()
			gain.disconnect()
			const i = this.voices.indexOf(voice)
			if (i !== -1) this.voices.splice(i, 1)
		}
	}

	private enforceVoiceCap(): void {
		while (this.voices.length > MAX_VOICES) {
			const oldest = this.voices.shift()
			if (!oldest) break
			try {
				oldest.osc.stop()
			} catch {
				// Already stopped; ignore.
			}
			oldest.osc.disconnect()
			oldest.gain.disconnect()
		}
	}
}
