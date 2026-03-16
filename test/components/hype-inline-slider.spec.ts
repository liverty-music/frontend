import { DI, ILogger, INode, Registration } from 'aurelia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '../helpers/mock-logger'

vi.mock(
	'@buf/liverty-music_schema.bufbuild_es/liverty_music/entity/v1/follow_pb.js',
	() => ({
		HypeType: { UNSPECIFIED: 0, WATCH: 1, HOME: 2, NEARBY: 3, AWAY: 4 },
	}),
)

const { HypeInlineSlider } = await import(
	'../../src/components/hype-inline-slider/hype-inline-slider'
)

function createSliderWithHost(opts: {
	artistId?: string
	hype?: number
	isAuthenticated?: boolean
}) {
	const hostElement = document.createElement('div')
	document.body.appendChild(hostElement)

	const container = DI.createContainer()
	container.register(Registration.instance(ILogger, createMockLogger()))
	container.register(Registration.instance(INode, hostElement))

	const sut = container.invoke(HypeInlineSlider)
	sut.artistId = opts.artistId ?? 'artist-1'
	sut.hype = opts.hype ?? 1 // HypeType.WATCH
	sut.isAuthenticated = opts.isAuthenticated ?? false

	return { sut, hostElement }
}

function mockClickEvent(): Event & {
	preventDefault: ReturnType<typeof vi.fn>
} {
	return { preventDefault: vi.fn() } as unknown as Event & {
		preventDefault: ReturnType<typeof vi.fn>
	}
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

			sut.selectHype(4, mockClickEvent()) // HypeType.AWAY

			expect(handler).toHaveBeenCalledTimes(1)
			const event = handler.mock.calls[0][0] as CustomEvent
			expect(event.detail).toEqual({
				artistId: 'artist-1',
				hype: 4,
			})
		})

		it('should NOT dispatch hype-signup-prompt on tap', () => {
			const handler = vi.fn()
			hostElement.addEventListener('hype-signup-prompt', handler)

			sut.selectHype(2, mockClickEvent()) // HypeType.HOME

			expect(handler).not.toHaveBeenCalled()
		})

		it('should NOT call preventDefault on tap', () => {
			const event = mockClickEvent()

			sut.selectHype(2, event) // HypeType.HOME

			expect(event.preventDefault).not.toHaveBeenCalled()
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

			sut.selectHype(2, mockClickEvent()) // HypeType.HOME

			expect(handler).toHaveBeenCalledTimes(1)
		})

		it('should NOT dispatch hype-changed on tap', () => {
			const handler = vi.fn()
			hostElement.addEventListener('hype-changed', handler)

			sut.selectHype(4, mockClickEvent()) // HypeType.AWAY

			expect(handler).not.toHaveBeenCalled()
		})

		it('should call preventDefault to block radio selection', () => {
			const event = mockClickEvent()

			sut.selectHype(4, event) // HypeType.AWAY

			expect(event.preventDefault).toHaveBeenCalledTimes(1)
		})
	})
})
