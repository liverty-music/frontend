import { DI, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ILocalStorage } from '../adapter/storage/local-storage'
import { StorageKeys } from '../constants/storage-keys'
import { AudioEngine } from './audio-engine'

/** An AudioContext that starts suspended, as one created outside a gesture. */
class FakeAudioContext {
	static created: FakeAudioContext[] = []
	public state: AudioContextState = 'suspended'
	public readonly sampleRate = 48_000
	public readonly currentTime = 0
	public readonly destination = {}
	public readonly gains: { gain: { value: number } }[] = []
	public readonly resume = vi.fn(async () => {
		this.state = 'running'
	})
	public readonly createBuffer = vi.fn((_c: number, length: number) => ({
		getChannelData: () => new Float32Array(length),
	}))
	public readonly createOscillator = vi.fn()

	constructor() {
		FakeAudioContext.created.push(this)
	}

	createGain() {
		const g = { gain: { value: 1 }, connect: vi.fn() }
		this.gains.push(g)
		return g
	}
}

function engine(stored: Record<string, string> = {}): AudioEngine {
	const container = DI.createContainer()
	container.register(
		Registration.instance(ILocalStorage, {
			getItem: (k: string) => stored[k] ?? null,
			setItem: vi.fn(),
			removeItem: vi.fn(),
			removeByPrefix: vi.fn(),
		}),
	)
	return container.invoke(AudioEngine)
}

describe('AudioEngine audio graph', () => {
	beforeEach(() => {
		FakeAudioContext.created = []
		vi.stubGlobal('AudioContext', FakeAudioContext)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('prepare() builds the context and the noise buffer but leaves the context suspended', () => {
		const sut = engine()

		sut.prepare()

		expect(FakeAudioContext.created).toHaveLength(1)
		const ctx = FakeAudioContext.created[0]
		expect(ctx.createBuffer).toHaveBeenCalledOnce()
		expect(ctx.resume).not.toHaveBeenCalled()
		expect(ctx.state).toBe('suspended')
	})

	it('unlock() after prepare() reuses the prepared context and resumes it', () => {
		const sut = engine()
		sut.prepare()

		sut.unlock()

		expect(FakeAudioContext.created).toHaveLength(1)
		expect(FakeAudioContext.created[0].resume).toHaveBeenCalledOnce()
	})

	// @spec components/infrastructure/fan/web/route/discovery "Audio unlocked within a user gesture"
	it('starts no context outside a gesture: only unlock() resumes it', () => {
		const sut = engine()

		sut.prepare()
		sut.prepare()

		expect(FakeAudioContext.created[0].resume).not.toHaveBeenCalled()
	})

	// @spec components/infrastructure/fan/web/route/discovery "Muted user taps a bubble"
	it('produces no tap or landing tone when muted', () => {
		const sut = engine({ [StorageKeys.soundMuted]: '1' })
		sut.prepare()
		sut.unlock()

		sut.playTap(120)
		sut.playLanding(120)

		expect(FakeAudioContext.created[0].createOscillator).not.toHaveBeenCalled()
		expect(FakeAudioContext.created[0].gains[0].gain.value).toBe(0)
	})

	// @spec components/infrastructure/fan/web/route/discovery "Volume preference applied"
	it('scales the output to the stored volume through the master gain', () => {
		const sut = engine({ [StorageKeys.soundVolume]: '0.3' })

		sut.prepare()

		expect(FakeAudioContext.created[0].gains[0].gain.value).toBe(0.3)
	})
})
