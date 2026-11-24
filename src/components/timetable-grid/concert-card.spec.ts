import { DI, INode, Registration } from 'aurelia'
import { describe, expect, it, vi } from 'vitest'
import { ConcertCard } from './concert-card'

/** A card the way the template mounts it, with the event it dispatches to. */
function card(readonly = false) {
	const element = document.createElement('concert-card')
	const selected = vi.fn()
	element.addEventListener('event-selected', selected)
	const container = DI.createContainer()
	container.register(Registration.instance(INode, element))
	const sut = container.invoke(ConcertCard)
	sut.readonly = readonly
	return { sut, selected }
}

const key = (k: string, init: KeyboardEventInit = {}) =>
	new KeyboardEvent('keydown', { key: k, cancelable: true, ...init })

describe('ConcertCard keyboard', () => {
	it('opens on Enter, as on Space', () => {
		const { sut, selected } = card()
		const enter = key('Enter')
		sut.handleKeydown(enter)
		expect(selected).toHaveBeenCalledOnce()
		expect(enter.defaultPrevented).toBe(true)

		sut.handleKeydown(key(' '))
		expect(selected).toHaveBeenCalledTimes(2)
	})

	it('opens once for a held Enter', () => {
		const { sut, selected } = card()
		sut.handleKeydown(key('Enter'))
		sut.handleKeydown(key('Enter', { repeat: true }))
		expect(selected).toHaveBeenCalledOnce()
	})

	it('ignores other keys and stays shut in preview', () => {
		const { sut, selected } = card()
		sut.handleKeydown(key('a'))
		sut.handleKeydown(key('Tab'))
		expect(selected).not.toHaveBeenCalled()

		const preview = card(true)
		preview.sut.handleKeydown(key('Enter'))
		expect(preview.selected).not.toHaveBeenCalled()
	})
})
