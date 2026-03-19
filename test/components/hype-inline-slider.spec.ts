import { DI } from 'aurelia'
import { describe, expect, it } from 'vitest'

const { HypeInlineSlider } = await import(
	'../../src/components/hype-inline-slider/hype-inline-slider'
)

function createSlider(opts?: { artistId?: string; hype?: string }) {
	const container = DI.createContainer()
	const sut = container.invoke(HypeInlineSlider)
	sut.artistId = opts?.artistId ?? 'artist-1'
	sut.hype = opts?.hype ?? 'watch'
	return sut
}

describe('HypeInlineSlider', () => {
	it('should expose four hype stops in order', () => {
		const sut = createSlider()
		expect(sut.stops).toEqual(['watch', 'home', 'nearby', 'away'])
	})

	it('should default hype to watch', () => {
		const sut = createSlider()
		expect(sut.hype).toBe('watch')
	})

	it('should accept artistId bindable', () => {
		const sut = createSlider({ artistId: 'test-id' })
		expect(sut.artistId).toBe('test-id')
	})

	it('should accept hype bindable', () => {
		const sut = createSlider({ hype: 'away' })
		expect(sut.hype).toBe('away')
	})

	it('should have no custom methods (pure presentation)', () => {
		const sut = createSlider()
		const proto = Object.getPrototypeOf(sut)
		const aureliaLifecycle = new Set(['created', 'dispose', 'constructor'])
		const customMethods = Object.getOwnPropertyNames(proto).filter(
			(name) =>
				!aureliaLifecycle.has(name) && typeof proto[name] === 'function',
		)
		expect(customMethods).toEqual([])
	})
})
