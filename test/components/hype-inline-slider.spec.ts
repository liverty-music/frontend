import { DI, ILogger, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'

const { HypeInlineSlider } = await import(
	'../../src/components/hype-inline-slider/hype-inline-slider'
)

/**
 * HypeInlineSlider resolves INode via DI. We create a real HTMLElement and
 * register it as INode so that dispatchEvent works on an actual DOM node.
 */
function createSliderWithHost(opts: {
	artistId?: string
	hypeLevel?: string
	isAuthenticated?: boolean
}) {
	const hostElement = document.createElement('div')
	document.body.appendChild(hostElement)

	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(Registration.instance(INode, hostElement))

	const sut = container.invoke(HypeInlineSlider)
	sut.artistId = opts.artistId ?? 'artist-1'
	sut.hypeLevel = (opts.hypeLevel ?? 'watch') as any
	sut.isAuthenticated = opts.isAuthenticated ?? false

	return { sut, hostElement }
}

describe('HypeInlineSlider', () => {
	describe('authenticated user', () => {
		let sut: InstanceType<typeof HypeInlineSlider>
		let hostElement: HTMLElement

		beforeEach(() => {
			const result = createSliderWithHost({ isAuthenticated: true })
			sut = result.sut
			hostElement = result.hostElement
		})

		afterEach(() => {
			if (hostElement?.parentNode) {
				document.body.removeChild(hostElement)
			}
		})

		it('should dispatch hype-changed event with correct detail on tap', () => {
			const handler = vi.fn()
			hostElement.addEventListener('hype-changed', handler)

			sut.selectHype('away')

			expect(handler).toHaveBeenCalledTimes(1)
			const event = handler.mock.calls[0][0] as CustomEvent
			expect(event.detail).toEqual({
				artistId: 'artist-1',
				level: 'away',
			})
		})

		it('should NOT dispatch hype-signup-prompt on tap', () => {
			const handler = vi.fn()
			hostElement.addEventListener('hype-signup-prompt', handler)

			sut.selectHype('home')

			expect(handler).not.toHaveBeenCalled()
		})
	})

	describe('unauthenticated user', () => {
		let sut: InstanceType<typeof HypeInlineSlider>
		let hostElement: HTMLElement

		beforeEach(() => {
			const result = createSliderWithHost({ isAuthenticated: false })
			sut = result.sut
			hostElement = result.hostElement
		})

		afterEach(() => {
			if (hostElement?.parentNode) {
				document.body.removeChild(hostElement)
			}
		})

		it('should dispatch hype-signup-prompt event on tap', () => {
			const handler = vi.fn()
			hostElement.addEventListener('hype-signup-prompt', handler)

			sut.selectHype('home')

			expect(handler).toHaveBeenCalledTimes(1)
		})

		it('should NOT dispatch hype-changed on tap', () => {
			const handler = vi.fn()
			hostElement.addEventListener('hype-changed', handler)

			sut.selectHype('away')

			expect(handler).not.toHaveBeenCalled()
		})

		it('should NOT change hypeLevel on tap', () => {
			sut.hypeLevel = 'watch' as any

			sut.selectHype('away')

			expect(sut.hypeLevel).toBe('watch')
		})
	})
})
