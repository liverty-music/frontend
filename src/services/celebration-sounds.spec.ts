import { describe, expect, it } from 'vitest'
import { type CelebrationBus, playCheers } from './celebration-sounds'

/** An AudioContext stand-in that records the voices the sound starts. */
function fakeBus() {
	const started = { oscillators: 0, noise: 0 }
	const param = () => ({
		value: 0,
		setValueAtTime: () => {},
		linearRampToValueAtTime: () => {},
		exponentialRampToValueAtTime: () => {},
	})
	const node = () => ({ connect: () => {} })
	const ctx = {
		currentTime: 0,
		sampleRate: 8000,
		createGain: () => ({ ...node(), gain: param() }),
		createStereoPanner: () => ({ ...node(), pan: param() }),
		createBiquadFilter: () => ({
			...node(),
			type: '',
			frequency: param(),
			Q: param(),
		}),
		createOscillator: () => {
			started.oscillators += 1
			return { ...node(), frequency: param(), start: () => {}, stop: () => {} }
		},
		createBuffer: (_channels: number, length: number) => {
			const data = new Float32Array(length)
			return { getChannelData: () => data }
		},
		createBufferSource: () => {
			started.noise += 1
			return {
				...node(),
				buffer: null,
				loop: false,
				start: () => {},
				stop: () => {},
			}
		},
	}
	const bus = { ctx, dry: node(), wet: node() } as unknown as CelebrationBus
	return { bus, started }
}

describe('playCheers', () => {
	it('plays a popper, a cheering crowd, applause and a whistle', () => {
		const { bus, started } = fakeBus()

		playCheers(bus)

		// The popper's body, and the whistle with its wobble.
		expect(started.oscillators).toBe(3)
		// The popper's snap, the crowd's two vowels and the claps.
		expect(started.noise).toBeGreaterThan(60)
	})
})
