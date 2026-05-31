import { DI, resolve } from 'aurelia'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { StorageKeys } from '../constants/storage-keys'

/** Hard cap on simultaneously sounding voices to bound CPU usage. */
const MAX_VOICES = 16

const DEFAULT_VOLUME = 0.5

/**
 * Every tap plays the same fixed two-part "pu-chu" pop — no musical scale, no
 * per-bubble pitch, no combo. A low lippy "pu" thump fires first, then a short
 * high "chu" chirp a beat later.
 */

/** Low "pu" plosive thump pitch (Hz) — the lippy front of the pop. */
const PLOSIVE_FREQ = 160
/** The "pu" thump starts this many × above PLOSIVE_FREQ and drops onto it. */
const PLOSIVE_START_RATIO = 2.2
/** Duration of the "pu" thump's downward drop (seconds). */
const PLOSIVE_GLIDE_SEC = 0.012
/** Amplitude decay of the "pu" thump (seconds) — a quick lippy bump. */
const PLOSIVE_DECAY = 0.03
/** Gap (seconds) between the "pu" thump and the "chu" chirp — reads as 2 parts. */
const CHU_DELAY = 0.022
/** "chu" chirp pitch (Hz). */
const POP_FREQ = 820
/** The "chu" chirp starts this many × above POP_FREQ and drops fast onto it. */
const POP_START_RATIO = 2.4
/** Duration of the "chu" fast downward drop (seconds) — a snappy chirp. */
const POP_GLIDE_SEC = 0.016
/** Amplitude decay of the "chu" chirp (seconds) — short and dry. */
const POP_DECAY = 0.045
/** "chu" low-pass cutoff sweep (Hz): bright, lightly filtered — crisp, not wet. */
const POP_CUTOFF_FROM = 6500
const POP_CUTOFF_TO = 2200
/** Low resonance keeps it dry/crisp ("chu"), not wet/wobbly ("pun"). */
const POP_Q = 1.5
/** Length of the plosive noise breath at the attack (seconds) — the "pu". */
const NOISE_SEC = 0.009
/** Low-pass cutoff applied to the noise (Hz): low/lippy "pu", not a bright "ts". */
const NOISE_CUTOFF = 2000
/** Peak gain of the noise breath. */
const NOISE_PEAK = 0.7
/** Landing (absorption-settle) tone — a soft, low, fixed "boop". */
const LANDING_FREQ = 280
const LANDING_CUTOFF_FROM = 2200
const LANDING_CUTOFF_TO = 700
/** Default fallback glide duration when a voice does not override it. */
const GLIDE_SEC = 0.05
/** Default low-pass resonance. */
const FILTER_Q = 1.5

/**
 * Starting frequency for the pop's fast downward drop onto `landing`.
 * Returns a frequency ABOVE the target so the voice swoops down onto it.
 * Exposed for unit testing without a live AudioContext.
 */
export function glideStartFreq(landing: number): number {
	return landing * POP_START_RATIO
}

interface Voice {
	osc: OscillatorNode
	gain: GainNode
	filter: BiquadFilterNode | null
	startedAt: number
}

interface ToneOptions {
	type: OscillatorType
	attack: number
	decay: number
	peak: number
	/** When set, the oscillator sweeps from this frequency to the target. */
	glideFrom?: number
	/** Duration of the pitch sweep (seconds); falls back to GLIDE_SEC. */
	glideMs?: number
	/** Delay (seconds) before this voice starts, relative to the call time. */
	delay?: number
	/** Low-pass cutoff sweep applied across the voice's life (Hz). */
	cutoffFrom?: number
	cutoffTo?: number
	/** Low-pass resonance (Q); falls back to FILTER_Q. */
	q?: number
	/** Layer a short plosive noise click at the attack. */
	noise?: boolean
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
	/** Apply volume to the live output. Does NOT persist — call `persistVolume`. */
	setVolume(volume: number): void
	/** Persist the current volume (call once on slider release, not per tick). */
	persistVolume(): void
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
	/** Cached white-noise buffer, generated once and reused per tap transient. */
	private noiseBuffer: AudioBuffer | null = null

	private _muted: boolean
	private _volume: number

	private readonly storage = resolve(ILocalStorage)

	constructor() {
		this._muted = this.storage.getItem(StorageKeys.soundMuted) === '1'
		const storedRaw = this.storage.getItem(StorageKeys.soundVolume)
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

	public playTap(_hue: number): void {
		if (this._muted || !this.ctx || !this.master) return

		// "pu": a low, lippy plosive thump with a soft noise breath, at the front.
		this.spawnVoice(PLOSIVE_FREQ, {
			type: 'sine',
			attack: 0.001,
			decay: PLOSIVE_DECAY,
			peak: 0.8,
			glideFrom: PLOSIVE_FREQ * PLOSIVE_START_RATIO,
			glideMs: PLOSIVE_GLIDE_SEC,
			noise: true,
		})

		// "chu": a short, dry triangle that drops fast onto POP_FREQ, fired a beat
		// later so the tap reads as two distinct parts — "pu" then "chu".
		this.spawnVoice(POP_FREQ, {
			type: 'triangle',
			attack: 0.001,
			decay: POP_DECAY,
			peak: 0.85,
			delay: CHU_DELAY,
			glideFrom: glideStartFreq(POP_FREQ),
			glideMs: POP_GLIDE_SEC,
			cutoffFrom: POP_CUTOFF_FROM,
			cutoffTo: POP_CUTOFF_TO,
			q: POP_Q,
		})
	}

	public playLanding(_hue: number): void {
		if (this._muted || !this.ctx || !this.master) return
		// Soft, low fixed "boop" when a bubble finishes absorbing into the orb.
		this.spawnVoice(LANDING_FREQ, {
			type: 'sine',
			attack: 0.008,
			decay: 0.3,
			peak: 0.4,
			glideFrom: LANDING_FREQ * 1.5,
			glideMs: 0.06,
			cutoffFrom: LANDING_CUTOFF_FROM,
			cutoffTo: LANDING_CUTOFF_TO,
		})
	}

	public setMuted(muted: boolean): void {
		this._muted = muted
		this.storage.setItem(StorageKeys.soundMuted, muted ? '1' : '0')
		this.applyMasterGain()
	}

	public setVolume(volume: number): void {
		this._volume = Math.min(1, Math.max(0, volume))
		this.applyMasterGain()
	}

	public persistVolume(): void {
		this.storage.setItem(StorageKeys.soundVolume, String(this._volume))
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

	private spawnVoice(freq: number, opts: ToneOptions): void {
		const ctx = this.ctx
		const master = this.master
		if (!ctx || !master) return

		const t = ctx.currentTime + (opts.delay ?? 0)
		const end = t + opts.attack + opts.decay

		const osc = ctx.createOscillator()
		osc.type = opts.type
		if (opts.glideFrom !== undefined) {
			// Fast downward drop onto the target pitch — the pop's chirp.
			osc.frequency.setValueAtTime(opts.glideFrom, t)
			osc.frequency.exponentialRampToValueAtTime(
				freq,
				t + (opts.glideMs ?? GLIDE_SEC),
			)
		} else {
			osc.frequency.setValueAtTime(freq, t)
		}

		const gain = ctx.createGain()
		gain.gain.setValueAtTime(0.0001, t)
		gain.gain.linearRampToValueAtTime(opts.peak, t + opts.attack)
		gain.gain.exponentialRampToValueAtTime(0.0001, end)

		// Optional low-pass sweep rounds the timbre off toward a wet tail.
		let filter: BiquadFilterNode | null = null
		if (opts.cutoffFrom !== undefined && opts.cutoffTo !== undefined) {
			filter = ctx.createBiquadFilter()
			filter.type = 'lowpass'
			filter.Q.value = opts.q ?? FILTER_Q
			filter.frequency.setValueAtTime(opts.cutoffFrom, t)
			filter.frequency.exponentialRampToValueAtTime(opts.cutoffTo, end)
			osc.connect(filter)
			filter.connect(gain)
		} else {
			osc.connect(gain)
		}
		gain.connect(master)
		osc.start(t)
		osc.stop(end + 0.02)

		if (opts.noise) this.spawnNoiseTransient(t)

		const voice: Voice = { osc, gain, filter, startedAt: t }
		this.voices.push(voice)
		this.enforceVoiceCap()

		osc.onended = (): void => {
			osc.disconnect()
			filter?.disconnect()
			gain.disconnect()
			const i = this.voices.indexOf(voice)
			if (i !== -1) this.voices.splice(i, 1)
		}
	}

	/**
	 * Play a brief filtered-noise burst at `startAt` — the plosive "pu" breath of
	 * the pop. The noise buffer is generated once and reused; the short-lived
	 * graph self-disconnects on end and is not tracked as a pitched voice.
	 */
	private spawnNoiseTransient(startAt: number): void {
		const ctx = this.ctx
		const master = this.master
		if (!ctx || !master) return

		this.ensureNoiseBuffer()
		if (!this.noiseBuffer) return

		const t = startAt
		const end = t + NOISE_SEC
		const src = ctx.createBufferSource()
		src.buffer = this.noiseBuffer

		const filter = ctx.createBiquadFilter()
		filter.type = 'lowpass'
		filter.frequency.value = NOISE_CUTOFF

		const gain = ctx.createGain()
		gain.gain.setValueAtTime(NOISE_PEAK, t)
		gain.gain.exponentialRampToValueAtTime(0.0001, end)

		src.connect(filter)
		filter.connect(gain)
		gain.connect(master)
		src.start(t)
		src.stop(end + 0.01)

		src.onended = (): void => {
			src.disconnect()
			filter.disconnect()
			gain.disconnect()
		}
	}

	/** Generate and cache a short white-noise buffer for tap transients. */
	private ensureNoiseBuffer(): void {
		if (this.noiseBuffer || !this.ctx) return
		const length = Math.ceil(this.ctx.sampleRate * 0.05)
		const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
		const data = buffer.getChannelData(0)
		for (let i = 0; i < length; i++) {
			data[i] = Math.random() * 2 - 1
		}
		this.noiseBuffer = buffer
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
			oldest.filter?.disconnect()
			oldest.gain.disconnect()
		}
	}
}
