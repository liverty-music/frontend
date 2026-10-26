/**
 * The post-signup celebration's sound: a confetti popper, then a cheering
 * crowd with applause and a whistle. Synthesized from Web Audio nodes alone
 * (no audio files) and played into a bus that gives it a stereo room: a dry
 * path and a convolution-reverb send, both into the engine's master output, so
 * the app's mute and volume settings apply unchanged.
 */

/** Where a celebration sound plays into. */
export interface CelebrationBus {
	ctx: AudioContext
	/** Direct sound. */
	dry: AudioNode
	/** Reverb send. */
	wet: AudioNode
}

interface Placement {
	/** Seconds after the bus's current time. */
	at: number
	/** Stereo position, -1 (left) to 1 (right). */
	pan?: number
	/** Share sent to the reverb, 0 to 1. */
	send?: number
	gain: number
}

/** A stereo-placed gain stage feeding both the dry path and the reverb. */
function voiceOut(bus: CelebrationBus, place: Placement): GainNode {
	const { ctx } = bus
	const gain = ctx.createGain()
	gain.gain.value = 0
	const panner = ctx.createStereoPanner()
	panner.pan.value = place.pan ?? 0
	gain.connect(panner)
	panner.connect(bus.dry)
	const send = ctx.createGain()
	send.gain.value = place.send ?? 0.35
	panner.connect(send)
	send.connect(bus.wet)
	return gain
}

/** Attack to `peak`, then an exponential decay over `decay` seconds. */
function envelope(
	param: AudioParam,
	start: number,
	peak: number,
	attack: number,
	decay: number,
): number {
	param.setValueAtTime(0.0001, start)
	param.linearRampToValueAtTime(peak, start + attack)
	param.exponentialRampToValueAtTime(0.0001, start + attack + decay)
	return start + attack + decay
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()

/** One second of white noise per context, shared by every noisy voice. */
function noise(ctx: BaseAudioContext): AudioBuffer {
	const cached = noiseBuffers.get(ctx)
	if (cached) return cached
	const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
	const data = buffer.getChannelData(0)
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
	noiseBuffers.set(ctx, buffer)
	return buffer
}

/** A burst of filtered noise. */
function noiseBurst(
	bus: CelebrationBus,
	place: Placement & {
		type: BiquadFilterType
		freq: number
		q?: number
		attack?: number
		decay: number
	},
): void {
	const { ctx } = bus
	const t = ctx.currentTime + place.at
	const source = ctx.createBufferSource()
	source.buffer = noise(ctx)
	const filter = ctx.createBiquadFilter()
	filter.type = place.type
	filter.frequency.value = place.freq
	filter.Q.value = place.q ?? 1
	const out = voiceOut(bus, place)
	const end = envelope(
		out.gain,
		t,
		place.gain,
		place.attack ?? 0.001,
		place.decay,
	)
	source.connect(filter)
	filter.connect(out)
	source.start(t, Math.random() * 0.5)
	source.stop(end + 0.02)
}

/** A sine whose pitch drops fast: the body of a pop or a drum. */
function thump(
	bus: CelebrationBus,
	place: Placement & { from: number; to: number; decay: number },
): void {
	const { ctx } = bus
	const t = ctx.currentTime + place.at
	const osc = ctx.createOscillator()
	osc.frequency.setValueAtTime(place.from, t)
	osc.frequency.exponentialRampToValueAtTime(place.to, t + place.decay * 0.6)
	const out = voiceOut(bus, place)
	const end = envelope(out.gain, t, place.gain, 0.002, place.decay)
	osc.connect(out)
	osc.start(t)
	osc.stop(end + 0.02)
}

/** A confetti-popper crack: a noisy snap over a low pop. */
function popper(bus: CelebrationBus, at: number, pan = 0): void {
	noiseBurst(bus, {
		at,
		pan,
		type: 'bandpass',
		freq: 1800,
		q: 0.8,
		gain: 0.7,
		decay: 0.07,
		send: 0.5,
	})
	thump(bus, { at, pan, from: 220, to: 70, gain: 0.5, decay: 0.12 })
}

/** Applause: many single claps, each a short band of noise. */
function applause(bus: CelebrationBus, at: number, span: number): void {
	for (let i = 0; i < 70; i++) {
		const t = at + span * Math.random()
		const fade = 1 - (t - at) / span
		noiseBurst(bus, {
			at: t,
			pan: Math.random() * 1.8 - 0.9,
			type: 'bandpass',
			freq: 900 + Math.random() * 900,
			q: 1.4,
			gain: (0.28 + Math.random() * 0.2) * fade,
			decay: 0.035,
			send: 0.45,
		})
	}
}

/** A crowd's "yay": noise through two vowel formants, swelling then fading. */
function crowd(bus: CelebrationBus, at: number, length: number): void {
	const { ctx } = bus
	const t = ctx.currentTime + at
	for (const [freq, pan] of [
		[750, -0.4],
		[1250, 0.4],
	] as const) {
		const source = ctx.createBufferSource()
		source.buffer = noise(ctx)
		source.loop = true
		const formant = ctx.createBiquadFilter()
		formant.type = 'bandpass'
		formant.frequency.setValueAtTime(freq * 0.85, t)
		formant.frequency.linearRampToValueAtTime(freq, t + 0.3)
		formant.Q.value = 3
		const out = voiceOut(bus, { at, pan, gain: 0, send: 0.6 })
		out.gain.setValueAtTime(0.0001, t)
		out.gain.linearRampToValueAtTime(0.5, t + 0.25)
		out.gain.exponentialRampToValueAtTime(0.0001, t + length)
		source.connect(formant)
		formant.connect(out)
		source.start(t)
		source.stop(t + length + 0.05)
	}
}

/** A two-finger whistle: a sine gliding up with a fast vibrato. */
function whistle(bus: CelebrationBus, at: number): void {
	const { ctx } = bus
	const t = ctx.currentTime + at
	const osc = ctx.createOscillator()
	osc.frequency.setValueAtTime(2100, t)
	osc.frequency.exponentialRampToValueAtTime(2900, t + 0.18)
	osc.frequency.setValueAtTime(2900, t + 0.4)
	osc.frequency.exponentialRampToValueAtTime(2300, t + 0.6)
	const wobble = ctx.createOscillator()
	wobble.frequency.value = 9
	const wobbleDepth = ctx.createGain()
	wobbleDepth.gain.value = 40
	wobble.connect(wobbleDepth)
	wobbleDepth.connect(osc.frequency)
	const out = voiceOut(bus, { at, pan: 0.5, gain: 0, send: 0.5 })
	out.gain.setValueAtTime(0.0001, t)
	out.gain.linearRampToValueAtTime(0.12, t + 0.04)
	out.gain.setValueAtTime(0.12, t + 0.5)
	out.gain.exponentialRampToValueAtTime(0.0001, t + 0.65)
	osc.connect(out)
	for (const o of [osc, wobble]) {
		o.start(t)
		o.stop(t + 0.7)
	}
}

/** A popper, then a cheering crowd, applause and a whistle. */
export function playCheers(bus: CelebrationBus): void {
	popper(bus, 0, 0)
	crowd(bus, 0.05, 1.6)
	applause(bus, 0.08, 1.5)
	whistle(bus, 0.25)
}

/**
 * A stereo impulse response for the reverb: exponentially decaying noise,
 * generated once, so the sound gets a room without an audio file.
 */
export function makeReverbImpulse(
	ctx: BaseAudioContext,
	seconds = 1.8,
	decay = 3,
): AudioBuffer {
	const length = Math.floor(ctx.sampleRate * seconds)
	const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
	for (let channel = 0; channel < 2; channel++) {
		const data = impulse.getChannelData(channel)
		for (let i = 0; i < length; i++) {
			data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay
		}
	}
	return impulse
}
